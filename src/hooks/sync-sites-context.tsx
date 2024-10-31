import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';
import { useImportExport } from './use-import-export';
import { PullStateProgressInfo, useSyncStatesProgressInfo } from './use-sync-states-progress-info';

export type SiteBackupState = {
	backupId: string | null;
	status: PullStateProgressInfo;
	downloadUrl: string | null;
	selectedSite: SiteDetails;
};

type SyncSitesContextType = {
	pullStates: Record< number, SiteBackupState >;
	pullSite: ( remoteSiteId: number, selectedSite: SiteDetails ) => Promise< void >;
};

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
	const { importFile } = useImportExport();
	const pullStatesInfo = useSyncStatesProgressInfo();

	const pullSite = useCallback(
		async ( remoteSiteId: number, selectedSite: SiteDetails ) => {
			if ( ! client ) {
				return;
			}
			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					backupId: null,
					status: pullStatesInfo[ 'in-progress' ],
					downloadUrl: null,
					selectedSite,
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
					[ remoteSiteId ]: { ...prevStates[ remoteSiteId ], status: pullStatesInfo.failed },
				} ) );
			}
		},
		[ client, pullStatesInfo ]
	);

	const onBackupCompleted = useCallback(
		async ( remoteSiteId: number, downloadUrl: string, selectedSite: SiteDetails ) => {
			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					...prevStates[ remoteSiteId ],
					status: pullStatesInfo.completed,
					downloadUrl,
				},
			} ) );

			const filePath = await getIpcApi().downloadSyncBackup( remoteSiteId, downloadUrl );

			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					...prevStates[ remoteSiteId ],
					status: pullStatesInfo.importing,
					downloadUrl,
				},
			} ) );

			await importFile(
				{
					path: filePath,
					type: 'application/tar+gzip',
				},
				selectedSite
			);

			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					...prevStates[ remoteSiteId ],
					status: pullStatesInfo.finished,
				},
			} ) );
			setTimeout( () => {
				setPullStates( ( prevStates ) => {
					const newStates = { ...prevStates };
					delete newStates[ remoteSiteId ];
					return newStates;
				} );
			}, 1000 );
		},
		[ importFile, pullStatesInfo.completed, pullStatesInfo.finished, pullStatesInfo.importing ]
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

			const statusWithProgress = pullStatesInfo[ response.status ] || pullStatesInfo.failed;
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

			if ( hasBackupCompleted && downloadUrl ) {
				// Replacing the 'in-progress' status will stop the active listening for the backup completion
				const selectedSite = pullStates[ remoteSiteId ]?.selectedSite;
				if ( ! selectedSite ) {
					return;
				}
				onBackupCompleted( remoteSiteId, downloadUrl, selectedSite );
			}
		},
		[ client, pullStates, pullStatesInfo, onBackupCompleted ]
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
