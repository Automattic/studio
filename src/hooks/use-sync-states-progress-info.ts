import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo } from 'react';
import { ImportProgressState } from './use-import-export';

export type PullStateProgressInfo = {
	key: 'in-progress' | 'downloading' | 'importing' | 'finished' | 'failed' | 'cancelled';
	progress: number;
	message: string;
};
export type PushStateProgressInfo = {
	key:
		| 'creatingBackup'
		| 'uploading'
		| 'creatingRemoteBackup'
		| 'applyingChanges'
		| 'finishing'
		| 'finished'
		| 'failed'
		| 'cancelled'
		| 'uploadingPaused';
	progress: number;
	message: string;
};

type PullStateProgressInfoValues = Record< PullStateProgressInfo[ 'key' ], PullStateProgressInfo >;
type PushStateProgressInfoValues = Record< PushStateProgressInfo[ 'key' ], PushStateProgressInfo >;

export type SyncBackupResponse = {
	status: 'in-progress' | 'finished' | 'failed';
	download_url: string;
	percent: number;
};

export type RestoreErrorData = {
	vp_restore_status?: string;
	vp_restore_message?: string;
	vp_rewind_id?: string | null;
};

export type ImportResponse = {
	status:
		| 'finished'
		| 'failed'
		| 'initial_backup_started'
		| 'archive_import_started'
		| 'archive_import_finished';
	success: boolean;
	backup_progress: number;
	import_progress: number;
	error?: string;
	error_data?: RestoreErrorData | null;
};

const IN_PROGRESS_INITIAL_VALUE = 30;
const DOWNLOADING_INITIAL_VALUE = 60;
const IN_PROGRESS_TO_DOWNLOADING_STEP = DOWNLOADING_INITIAL_VALUE - IN_PROGRESS_INITIAL_VALUE;
const PULL_IMPORTING_INITIAL_VALUE = 80;

export function useSyncStatesProgressInfo() {
	const { __ } = useI18n();
	const pullStatesProgressInfo = useMemo( () => {
		return {
			'in-progress': {
				key: 'in-progress',
				progress: IN_PROGRESS_INITIAL_VALUE,
				message: __( 'Initializing remote backup…' ),
			},
			downloading: {
				// On backend this key is called backup 'finished'
				key: 'downloading',
				progress: DOWNLOADING_INITIAL_VALUE,
				message: __( 'Downloading backup…' ),
			},
			importing: {
				key: 'importing',
				progress: PULL_IMPORTING_INITIAL_VALUE,
				message: __( 'Importing backup…' ),
			},
			finished: {
				key: 'finished',
				progress: 100,
				message: __( 'Pull complete' ),
			},
			failed: {
				key: 'failed',
				progress: 100,
				message: __( 'Error pulling changes' ),
			},
			cancelled: {
				key: 'cancelled',
				progress: 0,
				message: __( 'Cancelled' ),
			},
		} as const satisfies PullStateProgressInfoValues;
	}, [ __ ] );

	const pushStatesProgressInfo = useMemo( () => {
		return {
			creatingBackup: {
				key: 'creatingBackup',
				progress: 20,
				message: __( 'Creating backup…' ),
			},
			uploading: {
				key: 'uploading',
				progress: 40,
				message: __( 'Uploading site…' ),
			},
			uploadingPaused: {
				key: 'uploadingPaused',
				progress: 45,
				message: __( 'Uploading paused' ),
			},
			creatingRemoteBackup: {
				key: 'creatingRemoteBackup',
				progress: 50,
				message: __( 'Backing up remote site…' ),
			},
			applyingChanges: {
				key: 'applyingChanges',
				progress: 60,
				message: __( 'Applying changes…' ),
			},
			finishing: {
				key: 'finishing',
				progress: 99,
				message: __( 'Almost there…' ),
			},
			finished: {
				key: 'finished',
				progress: 100,
				message: __( 'Push complete' ),
			},
			failed: {
				key: 'failed',
				progress: 100,
				message: __( 'Error pushing changes' ),
			},
			cancelled: {
				key: 'cancelled',
				progress: 0,
				message: __( 'Cancelled' ),
			},
		} as const satisfies PushStateProgressInfoValues;
	}, [ __ ] );

	const isKeyPulling = ( key: PullStateProgressInfo[ 'key' ] | undefined ) => {
		const pullingStateKeys: PullStateProgressInfo[ 'key' ][] = [
			'in-progress',
			'downloading',
			'importing',
		];
		if ( ! key ) {
			return false;
		}
		return pullingStateKeys.includes( key );
	};

	const isKeyPushing = ( key: PushStateProgressInfo[ 'key' ] | undefined ) => {
		const pushingStateKeys: PushStateProgressInfo[ 'key' ][] = [
			'creatingBackup',
			'uploading',
			'creatingRemoteBackup',
			'applyingChanges',
			'finishing',
		];
		if ( ! key ) {
			return false;
		}
		return pushingStateKeys.includes( key );
	};

	const isKeyUploadingPaused = ( key: PushStateProgressInfo[ 'key' ] | undefined ) => {
		return key === 'uploadingPaused';
	};

	const isKeyUploading = useCallback( ( key: PushStateProgressInfo[ 'key' ] | undefined ) => {
		return key === 'uploading';
	}, [] );

	const isKeyImporting = ( key: PushStateProgressInfo[ 'key' ] | undefined ) => {
		const pushingStateKeys: PushStateProgressInfo[ 'key' ][] = [
			'creatingRemoteBackup',
			'applyingChanges',
			'finishing',
		];
		if ( ! key ) {
			return false;
		}
		return pushingStateKeys.includes( key );
	};
	const isKeyFinished = useCallback(
		( key: PullStateProgressInfo[ 'key' ] | PushStateProgressInfo[ 'key' ] | undefined ) => {
			return key === 'finished';
		},
		[]
	);

	const isKeyFailed = useCallback(
		( key: PullStateProgressInfo[ 'key' ] | PushStateProgressInfo[ 'key' ] | undefined ) => {
			return key === 'failed';
		},
		[]
	);

	const isKeyCancelled = useCallback(
		( key: PullStateProgressInfo[ 'key' ] | PushStateProgressInfo[ 'key' ] | undefined ) => {
			return key === 'cancelled';
		},
		[]
	);

	const getBackupStatusWithProgress = useCallback(
		(
			hasBackupCompleted: boolean,
			pullStatesProgressInfo: PullStateProgressInfoValues,
			response: SyncBackupResponse
		) => {
			const frontendStatus = hasBackupCompleted
				? pullStatesProgressInfo.downloading.key
				: response.status;
			let newProgressInfo: PullStateProgressInfo | null = null;
			if ( response.status === 'in-progress' ) {
				newProgressInfo = pullStatesProgressInfo[ frontendStatus ];
				// Update progress from the initial value to the new step proportionally to the response.progress
				// on every update of the response.progress
				newProgressInfo.progress =
					IN_PROGRESS_INITIAL_VALUE + IN_PROGRESS_TO_DOWNLOADING_STEP * ( response.percent / 100 );
			}
			const statusWithProgress = newProgressInfo || pullStatesProgressInfo[ frontendStatus ];

			return statusWithProgress;
		},
		[]
	);

	const getPullStatusWithProgress = useCallback(
		( sitePullState?: PullStateProgressInfo, importState?: ImportProgressState[ string ] ) => {
			if ( importState ) {
				if ( importState.progress === 100 ) {
					return { message: __( 'Applying final details…' ), progress: 99 };
				}
				const stepToProgress = 100 - PULL_IMPORTING_INITIAL_VALUE;
				return {
					message: importState.statusMessage,
					// Update progress from the initial value to the new step proportionally to the importState.progress
					// on every update of the importState.progress
					progress: PULL_IMPORTING_INITIAL_VALUE + stepToProgress * ( importState.progress / 100 ),
				};
			}
			if ( sitePullState ) {
				return { message: sitePullState.message, progress: sitePullState.progress };
			}
			return { message: '', progress: 0 };
		},
		[ __ ]
	);

	const getPushStatusWithProgress = useCallback(
		( status: PushStateProgressInfo, response: ImportResponse ) => {
			if ( status.key === pushStatesProgressInfo.creatingRemoteBackup.key ) {
				const progressRange =
					pushStatesProgressInfo.applyingChanges.progress -
					pushStatesProgressInfo.creatingRemoteBackup.progress;

				// This step will increase the progress to the next step progressively based on the backup_progress
				return {
					...status,
					progress:
						pushStatesProgressInfo.creatingRemoteBackup.progress +
						progressRange * ( response.backup_progress / 100 ),
				};
			}

			// This step will increase the progress to the next step progressively based on the import_progress
			if (
				status.key === pushStatesProgressInfo.applyingChanges.key &&
				response.import_progress < 100
			) {
				const progressRange =
					pushStatesProgressInfo.finishing.progress -
					pushStatesProgressInfo.applyingChanges.progress;
				return {
					...status,
					progress:
						pushStatesProgressInfo.applyingChanges.progress +
						progressRange * ( response.import_progress / 100 ),
				};
			}
			return status;
		},
		[
			pushStatesProgressInfo.applyingChanges.key,
			pushStatesProgressInfo.applyingChanges.progress,
			pushStatesProgressInfo.creatingRemoteBackup.key,
			pushStatesProgressInfo.creatingRemoteBackup.progress,
			pushStatesProgressInfo.finishing.progress,
		]
	);

	const getPushUploadPercentage = useCallback(
		(
			statusKey: PushStateProgressInfo[ 'key' ] | undefined,
			uploadProgress: number | undefined
		): number | null => {
			if ( isKeyUploading( statusKey ) && uploadProgress !== undefined ) {
				return Math.round( uploadProgress );
			}
			return null;
		},
		[ isKeyUploading ]
	);

	const getPushUploadMessage = useCallback(
		( message: string, uploadPercentage: number | null ): string => {
			if ( uploadPercentage !== null ) {
				// translators: %d is the upload progress percentage
				return sprintf( __( 'Uploading site (%d%%)…' ), uploadPercentage );
			}
			return message;
		},
		[ __ ]
	);

	const mapUploadProgressToOverallProgress = useCallback(
		( uploadProgress: number ): number => {
			// Map upload progress (0-100%) to the uploading state range (40-50%)
			const uploadingProgressRange =
				pushStatesProgressInfo.creatingRemoteBackup.progress -
				pushStatesProgressInfo.uploading.progress;
			return (
				pushStatesProgressInfo.uploading.progress +
				( uploadProgress / 100 ) * uploadingProgressRange
			);
		},
		[
			pushStatesProgressInfo.creatingRemoteBackup.progress,
			pushStatesProgressInfo.uploading.progress,
		]
	);

	return {
		pullStatesProgressInfo,
		pushStatesProgressInfo,
		isKeyPulling,
		isKeyPushing,
		isKeyImporting,
		isKeyFinished,
		isKeyFailed,
		isKeyCancelled,
		isKeyUploading,
		getBackupStatusWithProgress,
		getPullStatusWithProgress,
		getPushStatusWithProgress,
		getPushUploadPercentage,
		getPushUploadMessage,
		mapUploadProgressToOverallProgress,
		isKeyUploadingPaused,
	};
}
