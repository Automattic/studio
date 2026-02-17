import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo } from 'react';

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
		| 'uploadingPaused'
		| 'uploadingManuallyPaused';
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
const PULL_IMPORTING_INITIAL_VALUE = 80;

function getPushUploadPercentage(
	statusKey: PushStateProgressInfo[ 'key' ] | undefined,
	uploadProgress: number | undefined
): number | null {
	if ( statusKey === 'uploading' && uploadProgress !== undefined ) {
		return Math.round( uploadProgress );
	}
	return null;
}

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
			uploadingManuallyPaused: {
				key: 'uploadingManuallyPaused',
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

	const uploadingProgressMessageTemplate = useMemo( () => __( 'Uploading site (%d%%)…' ), [ __ ] );

	const getPushUploadMessage = useCallback(
		( message: string, uploadPercentage: number | null ): string => {
			if ( uploadPercentage !== null ) {
				// translators: %d is the upload progress percentage
				return sprintf( uploadingProgressMessageTemplate, uploadPercentage );
			}
			return message;
		},
		[ uploadingProgressMessageTemplate ]
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
		getPushUploadPercentage,
		getPushUploadMessage,
		mapUploadProgressToOverallProgress,
	};
}
