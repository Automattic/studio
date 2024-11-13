import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo } from 'react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { useImportExport } from '../use-import-export';
import { useSyncStatesProgressInfo } from '../use-sync-states-progress-info';
import { SiteBackupState } from './sync-sites-context';

export function useSyncPull( {
	pullStates,
	setPullStates,
}: {
	pullStates: Record< number, SiteBackupState >;
	setPullStates: React.Dispatch< React.SetStateAction< Record< number, SiteBackupState > > >;
} ) {
	const { __ } = useI18n();
	const { client } = useAuth();
	const { importFile } = useImportExport();
	const { pullStatesProgressInfo, isKeyPulling } = useSyncStatesProgressInfo();
	const updatePullState = useCallback(
		( remoteSiteId: number, state: Partial< SiteBackupState > ) => {
			setPullStates( ( prevStates ) => ( {
				...prevStates,
				[ remoteSiteId ]: { ...prevStates[ remoteSiteId ], ...state },
			} ) );
		},
		[ setPullStates ]
	);
	const deletePullState = useCallback(
		( remoteSiteId: number ) => {
			setPullStates( ( prevStates ) => {
				const newStates = { ...prevStates };
				delete newStates[ remoteSiteId ];
				return newStates;
			} );
		},
		[ setPullStates ]
	);

	const pullSite = useCallback(
		async ( remoteSiteId: number, selectedSite: SiteDetails ) => {
			if ( ! client ) {
				return;
			}
			updatePullState( remoteSiteId, {
				backupId: null,
				status: pullStatesProgressInfo[ 'in-progress' ],
				downloadUrl: null,
				selectedSite,
			} );

			try {
				const response = await client.req.post< { success: boolean; backup_id: string } >( {
					path: `/sites/${ remoteSiteId }/studio-app/sync/backup`,
					apiNamespace: 'wpcom/v2',
				} );

				if ( response.success ) {
					updatePullState( remoteSiteId, {
						backupId: response.backup_id,
					} );
				} else {
					throw new Error( 'Pull request failed' );
				}
			} catch ( error ) {
				console.error( error );
				updatePullState( remoteSiteId, {
					status: pullStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: __( 'Failed to pull backup' ),
					message: error instanceof Error ? error.message : __( 'Unknown error' ),
				} );
			}
		},
		[ __, client, pullStatesProgressInfo, updatePullState ]
	);

	const onBackupCompleted = useCallback(
		async ( remoteSiteId: number, downloadUrl: string, selectedSite: SiteDetails ) => {
			updatePullState( remoteSiteId, {
				status: pullStatesProgressInfo.completed,
				downloadUrl,
			} );

			const filePath = await getIpcApi().downloadSyncBackup( remoteSiteId, downloadUrl );

			updatePullState( remoteSiteId, {
				status: pullStatesProgressInfo.importing,
			} );

			await importFile(
				{
					path: filePath,
					type: 'application/tar+gzip',
				},
				selectedSite
			);

			updatePullState( remoteSiteId, {
				status: pullStatesProgressInfo.finished,
			} );
			setTimeout( () => {
				deletePullState( remoteSiteId );
			}, 1000 );
		},
		[
			deletePullState,
			importFile,
			pullStatesProgressInfo.completed,
			pullStatesProgressInfo.finished,
			pullStatesProgressInfo.importing,
			updatePullState,
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

			if ( hasBackupCompleted && downloadUrl ) {
				// Replacing the 'in-progress' status will stop the active listening for the backup completion
				const selectedSite = pullStates[ remoteSiteId ]?.selectedSite;
				if ( ! selectedSite ) {
					return;
				}
				onBackupCompleted( remoteSiteId, downloadUrl, selectedSite );
			} else {
				updatePullState( remoteSiteId, {
					status: statusWithProgress,
					downloadUrl,
				} );
			}
		},
		[ client, onBackupCompleted, pullStates, pullStatesProgressInfo, updatePullState ]
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

	const isSiteIdPulling = useCallback(
		( selectedSiteId: string ) => {
			return Object.values( pullStates ).some( ( state ) => {
				return state.selectedSite.id === selectedSiteId && isKeyPulling( state.status.key );
			} );
		},
		[ pullStates, isKeyPulling ]
	);

	return { pullStates, pullSite, isAnySitePulling, isSiteIdPulling };
}
