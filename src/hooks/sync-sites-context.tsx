import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';

export const PULL_STATES = {
	'in-progress': {
		key: 'in-progress',
		progress: 30,
	},
	// Backup completed on server, downloading on client
	completed: {
		key: 'backup-sync-downloading',
		progress: 60,
	},
	importing: {
		key: 'backup-sync-importing',
		progress: 80,
	},
	finished: {
		key: 'backup-sync-finished',
		progress: 100,
	},
	failed: {
		key: 'failed',
		progress: 100,
	},
} as const;

type PullState = ( typeof PULL_STATES )[ keyof typeof PULL_STATES ];

interface SiteBackupState {
	backupId: string | null;
	status: ( typeof PULL_STATES )[ keyof typeof PULL_STATES ];
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
				[ remoteSiteId ]: {
					backupId: null,
					status: PULL_STATES[ 'in-progress' ],
					downloadUrl: null,
				},
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
					[ remoteSiteId ]: { ...prevStates[ remoteSiteId ], status: PULL_STATES.failed },
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

			const statusWithProgress = PULL_STATES[ response.status ] || PULL_STATES.failed;
			const hasBackupCompleted = response.status === 'completed';
			const downloadUrl = hasBackupCompleted ? response.download_url : null;

			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					...prevStates[ remoteSiteId ],
					status: statusWithProgress,
					downloadUrl,
				},
			} ) );

			if ( hasBackupCompleted ) {
				const filePath = await getIpcApi().downloadSyncBackup(
					remoteSiteId,
					response.download_url
				);
				console.log( '----> filePath', filePath );
				setPullStates( ( prevStates ) => ( {
					...prevStates,
					[ remoteSiteId ]: {
						...prevStates[ remoteSiteId ],
						status: PULL_STATES.importing,
						downloadUrl,
					},
				} ) );
			}
		},
		[ client, pullStates ]
	);

	useEffect( () => {
		const intervals: Record< number, NodeJS.Timeout > = {};

		Object.entries( pullStates ).forEach( ( [ remoteSiteId, state ] ) => {
			if ( state.backupId && state.status.key === 'in-progress' ) {
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
