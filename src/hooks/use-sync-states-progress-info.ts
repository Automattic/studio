import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo } from 'react';

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

export function useSyncStatesProgressInfo() {
	const { __ } = useI18n();
	const pullStatesProgressInfo = useMemo( () => {
		return {
			'in-progress': {
				key: 'in-progress',
				progress: 30,
				message: __( 'Initializing backup…' ),
			},
			downloading: {
				// On backend this key is called backup 'finished'
				key: 'downloading',
				progress: 60,
				message: __( 'Downloading backup…' ),
			},
			importing: {
				key: 'importing',
				progress: 80,
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
		} as const;
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

	return {
		pullStatesProgressInfo,
		pushStatesProgressInfo,
		isKeyPulling,
		isKeyPushing,
		isKeyFinished,
		isKeyFailed,
	};
}
