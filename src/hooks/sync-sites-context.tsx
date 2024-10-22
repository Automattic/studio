import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './use-auth';

interface SiteBackupState {
	backupId: string | null;
	status: '' | 'in-progress' | 'completed' | 'failed';
	downloadUrl: string | null;
}

interface SyncSitesContextType {
	pullStates: Record< number, SiteBackupState >;
	pullSite: ( remoteSiteId: number ) => Promise< void >;
}

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const { pullStates, pullSite } = useSyncPull();

	return (
		<SyncSitesContext.Provider value={ { pullStates, pullSite } }>
			{ children }
		</SyncSitesContext.Provider>
	);
}

function useSyncPull() {
	const { client } = useAuth();
	const [ pullStates, setPullStates ] = useState< Record< number, SiteBackupState > >( {} );

	const pullSite = useCallback(
		async ( remoteSiteId: number ) => {
			if ( ! client ) {
				return;
			}
			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: { backupId: null, status: 'in-progress', downloadUrl: null },
			} ) );
			try {
				const response = await client.req.post< { success: boolean; backup_id: string } >( {
					path: `/sites/${ remoteSiteId }/studio-app/sync/backup`,
					apiNamespace: 'wpcom/v2',
				} );

				if ( response.success ) {
					setPullStates( ( prevStates ) => ( {
						...prevStates,
						[ remoteSiteId ]: { ...prevStates[ remoteSiteId ], backupId: response.backup_id },
					} ) );
				} else {
					throw new Error( 'Pull request failed' );
				}
			} catch ( error ) {
				console.error( error );
				setPullStates( ( prevStates ) => ( {
					...prevStates,
					[ remoteSiteId ]: { ...prevStates[ remoteSiteId ], status: 'failed' },
				} ) );
			}
		},
		[ client ]
	);

	const getBackup = useCallback(
		async ( remoteSiteId: number ) => {
			if ( ! client ) {
				return;
			}
			const backupId = pullStates[ remoteSiteId ]?.backupId;
			if ( ! backupId ) {
				console.error( 'No backup ID found' );
				return;
			}
			const response = await client.req.get< {
				status: 'in-progress' | 'completed' | 'failed';
				download_url: string;
			} >( `/sites/${ remoteSiteId }/studio-app/sync/backup`, {
				apiNamespace: 'wpcom/v2',
				backup_id: backupId,
			} );

			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					...prevStates[ remoteSiteId ],
					status: response.status,
					downloadUrl: response.status === 'completed' ? response.download_url : null,
				},
			} ) );
		},
		[ client, pullStates ]
	);

	useEffect( () => {
		const intervals: Record< number, NodeJS.Timeout > = {};

		Object.entries( pullStates ).forEach( ( [ remoteSiteId, state ] ) => {
			if ( state.backupId && state.status === 'in-progress' ) {
				intervals[ Number( remoteSiteId ) ] = setInterval( () => {
					getBackup( Number( remoteSiteId ) );
				}, 2000 );
			}
		} );

		return () => {
			Object.values( intervals ).forEach( clearInterval );
		};
	}, [ pullStates, getBackup ] );

	return { pullStates, pullSite };
}

export function useSyncSites() {
	const context = useContext( SyncSitesContext );
	if ( context === undefined ) {
		throw new Error( 'useSyncSites must be used within a SyncSitesProvider' );
	}
	return context;
}
