import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './use-auth';
import { useImportExport } from './use-import-export';

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

interface SiteBackupState {
	backupId: string | null;
	status: ( typeof PULL_STATES )[ keyof typeof PULL_STATES ];
	downloadUrl: string | null;
	selectedSite: SiteDetails;
}

interface SyncSitesContextType {
	pullStates: Record< number, SiteBackupState >;
	pullSite: ( remoteSiteId: number, selectedSite: SiteDetails ) => Promise< void >;
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
	const { importFile } = useImportExport();

	const pullSite = useCallback(
		async ( remoteSiteId: number, selectedSite: SiteDetails ) => {
			if ( ! client ) {
				return;
			}
			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					backupId: null,
					status: PULL_STATES[ 'in-progress' ],
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
					[ remoteSiteId ]: { ...prevStates[ remoteSiteId ], status: PULL_STATES.failed },
				} ) );
			}
		},
		[ client ]
	);

	const onBackupCompleted = useCallback(
		async ( remoteSiteId: number, downloadUrl: string, selectedSite: SiteDetails ) => {
			// const filePath = await getIpcApi().downloadSyncBackup( remoteSiteId, downloadUrl );
			const filePath =
				'/private/var/folders/_x/rbv26n3925q_01dbs4jzd8t80000gn/T/wp-studio-backups/site-234098253-backup.zip';
			console.log( '----> filePath, importing', filePath );
			await importFile(
				{
					path: filePath,
					type: 'zip',
				},
				selectedSite
			);
			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					...prevStates[ remoteSiteId ],
					status: PULL_STATES.finished,
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
		[ importFile ]
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

			if ( hasBackupCompleted && downloadUrl ) {
				// Replacing the 'in-progress' status will stop the active listening for the backup completion
				const selectedSite = pullStates[ remoteSiteId ]?.selectedSite;
				if ( ! selectedSite ) {
					return;
				}
				setPullStates( ( prevStates ) => ( {
					...prevStates,
					[ remoteSiteId ]: {
						...prevStates[ remoteSiteId ],
						status: PULL_STATES.importing,
						downloadUrl,
					},
				} ) );
				onBackupCompleted( remoteSiteId, downloadUrl, selectedSite );
			}
		},
		[ client, pullStates, onBackupCompleted ]
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
