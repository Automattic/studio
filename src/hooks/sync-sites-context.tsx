import { useI18n } from '@wordpress/react-i18n';
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
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
	isAnySitePulling: boolean;
};

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const { pullStates, pullSite, isAnySitePulling } = useSyncPull();

	return (
		<SyncSitesContext.Provider value={ { pullStates, pullSite, isAnySitePulling } }>
			{ children }
		</SyncSitesContext.Provider>
	);
}

function useSyncPull() {
	const { __ } = useI18n();
	const { client } = useAuth();
	const [ pullStates, setPullStates ] = useState< Record< number, SiteBackupState > >( {} );
	const { importFile } = useImportExport();
	const { pullStatesProgressInfo, isKeyPulling } = useSyncStatesProgressInfo();

	const pullSite = useCallback(
		async ( remoteSiteId: number, selectedSite: SiteDetails ) => {
			if ( ! client ) {
				return;
			}
			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					backupId: null,
					status: pullStatesProgressInfo[ 'in-progress' ],
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
					[ remoteSiteId ]: {
						...prevStates[ remoteSiteId ],
						status: pullStatesProgressInfo.failed,
					},
				} ) );
				getIpcApi().showErrorMessageBox( {
					title: __( 'Failed to pull backup' ),
					message: error instanceof Error ? error.message : __( 'Unknown error' ),
				} );
			}
		},
		[ __, client, pullStatesProgressInfo ]
	);

	const onBackupCompleted = useCallback(
		async ( remoteSiteId: number, downloadUrl: string, selectedSite: SiteDetails ) => {
			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					...prevStates[ remoteSiteId ],
					status: pullStatesProgressInfo.completed,
					downloadUrl,
				},
			} ) );

			const filePath = await getIpcApi().downloadSyncBackup( remoteSiteId, downloadUrl );

			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: {
					...prevStates[ remoteSiteId ],
					status: pullStatesProgressInfo.importing,
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
					status: pullStatesProgressInfo.finished,
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
		[
			importFile,
			pullStatesProgressInfo.completed,
			pullStatesProgressInfo.finished,
			pullStatesProgressInfo.importing,
		]
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

			const statusWithProgress =
				pullStatesProgressInfo[ response.status ] || pullStatesProgressInfo.failed;
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
		[ client, pullStates, pullStatesProgressInfo, onBackupCompleted ]
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

	const isAnySitePulling = useMemo( () => {
		return Object.values( pullStates ).some( ( state ) => isKeyPulling( state.status.key ) );
	}, [ pullStates, isKeyPulling ] );

	return { pullStates, pullSite, isAnySitePulling };
}

export function useSyncSites() {
	const context = useContext( SyncSitesContext );
	if ( context === undefined ) {
		throw new Error( 'useSyncSites must be used within a SyncSitesProvider' );
	}
	return context;
}
