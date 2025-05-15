import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo } from 'react';
import { ImportProgressState } from './use-import-export';

export type PullStateProgressInfo = {
	key: 'in-progress' | 'downloading' | 'importing' | 'finished' | 'failed' | 'cancelled';
	progress: number;
	message: string;
};
export type PushStateProgressInfo = {
	key: 'creatingBackup' | 'uploading' | 'importing' | 'finished' | 'failed';
	progress: number;
	message: string;
};

export type PushStateProgressInfoValues = Record<
	PushStateProgressInfo[ 'key' ],
	PushStateProgressInfo
>;

export type PullStateProgressInfoValues = Record<
	PullStateProgressInfo[ 'key' ],
	PullStateProgressInfo
>;

export type SyncBackupResponse = {
	status: 'in-progress' | 'finished' | 'failed';
	download_url: string;
	percent: number;
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
};

const IN_PROGRESS_INITIAL_VALUE = 30;
const DOWNLOADING_INITIAL_VALUE = 60;
const IN_PROGRESS_TO_DOWNLOADING_STEP = DOWNLOADING_INITIAL_VALUE - IN_PROGRESS_INITIAL_VALUE;
const PULL_IMPORTING_INITIAL_VALUE = 80;
const PUSH_IMPORTING_INITIAL_VALUE = 60;

export function useSyncStatesProgressInfo() {
	const { __ } = useI18n();
	const pullStatesProgressInfo = useMemo( () => {
		return {
			'in-progress': {
				key: 'in-progress',
				progress: IN_PROGRESS_INITIAL_VALUE,
				message: __( 'Initializing backup…' ),
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
		} satisfies PullStateProgressInfoValues;
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
				message: __( 'Uploading Studio site…' ),
			},
			importing: {
				key: 'importing',
				progress: PUSH_IMPORTING_INITIAL_VALUE,
				message: __( 'Keeping your site safe…' ),
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
		} satisfies PushStateProgressInfoValues;
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
			'importing',
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
				newProgressInfo.progress =
					IN_PROGRESS_INITIAL_VALUE + IN_PROGRESS_TO_DOWNLOADING_STEP * ( response.percent / 100 );
			}
			const statusWithProgress =
				newProgressInfo ||
				pullStatesProgressInfo[ frontendStatus ] ||
				pullStatesProgressInfo.failed;

			return statusWithProgress;
		},
		[]
	);

	const getPullStatusWithProgress = useCallback(
		( sitePullState?: PullStateProgressInfo, importState?: ImportProgressState[ string ] ) => {
			if ( ! importState && sitePullState ) {
				return { message: sitePullState.message, progress: sitePullState.progress };
			}
			if ( importState ) {
				if ( importState.progress === 100 ) {
					return { message: __( 'Applying final details…' ), progress: 99 };
				}
				const stepToProgress = 100 - PULL_IMPORTING_INITIAL_VALUE;
				return {
					message: importState.statusMessage,
					progress: PULL_IMPORTING_INITIAL_VALUE + stepToProgress * ( importState.progress / 100 ),
				};
			}
			return { message: '', progress: 0 };
		},
		[ __ ]
	);

	const getPushStatusWithProgress = useCallback(
		( status: PushStateProgressInfo, response: ImportResponse ) => {
			if ( status.key === pushStatesProgressInfo.importing.key ) {
				const backupStep = 10;
				const archiveInitialValue = PUSH_IMPORTING_INITIAL_VALUE + backupStep;
				const archiveStep = 30;

				// This step will increase the progress in 10 (from 60 to 70) progressively based on the backup_progress
				if ( response.status === 'initial_backup_started' ) {
					return {
						...status,
						progress:
							PUSH_IMPORTING_INITIAL_VALUE + backupStep * ( response.backup_progress / 100 ),
					};
				}
				// This step will increase the progress in 30 (from 70 to 100) progressively based on the import_progress
				if ( response.status === 'archive_import_started' && response.import_progress < 100 ) {
					return {
						...status,
						message: __( 'Applying changes…' ),
						progress: archiveInitialValue + archiveStep * ( response.import_progress / 100 ),
					};
				}
				if ( response.status === 'archive_import_finished' ) {
					return {
						...status,
						message: __( 'Last touches…' ),
						progress: 99,
					};
				}
			}
			return status;
		},
		[ __, pushStatesProgressInfo.importing.key ]
	);

	return {
		pullStatesProgressInfo,
		pushStatesProgressInfo,
		isKeyPulling,
		isKeyPushing,
		isKeyFinished,
		isKeyFailed,
		getBackupStatusWithProgress,
		getPullStatusWithProgress,
		getPushStatusWithProgress,
	};
}
