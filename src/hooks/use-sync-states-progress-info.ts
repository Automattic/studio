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

export type PullStateProgressInfoValues = Record<
	PullStateProgressInfo[ 'key' ],
	PullStateProgressInfo
>;

export type SyncBackupResponse = {
	status: 'in-progress' | 'finished' | 'failed';
	download_url: string;
	percent: number;
};

export const IN_PROGRESS_INITIAL_VALUE = 30;
const DOWNLOADING_INITIAL_VALUE = 60;
export const IN_PROGRESS_TO_DOWNLOADING_STEP =
	DOWNLOADING_INITIAL_VALUE - IN_PROGRESS_INITIAL_VALUE;
export const IMPORTING_INITIAL_VALUE = 80;
export const IMPORTING_TO_FINISHED_STEP = 100 - IMPORTING_INITIAL_VALUE;

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
				progress: IMPORTING_INITIAL_VALUE,
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
				progress: 30,
				message: __( 'Creating backup…' ),
			},
			uploading: {
				key: 'uploading',
				progress: 50,
				message: __( 'Uploading Studio site…' ),
			},
			importing: {
				key: 'importing',
				progress: 80,
				message: __( 'Applying changes…' ),
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
		} as const;
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
			if ( importState ) {
				if ( importState.progress === 100 ) {
					return { message: __( 'Applying final details…' ), progress: 99 };
				}
				return {
					message: importState.statusMessage,
					progress:
						IMPORTING_INITIAL_VALUE + IMPORTING_TO_FINISHED_STEP * ( importState.progress / 100 ),
				};
			}
			if ( sitePullState ) {
				return { message: sitePullState.message, progress: sitePullState.progress };
			}
			return { message: '', progress: 0 };
		},
		[ __ ]
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
	};
}
