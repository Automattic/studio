import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';

export type PullStateProgressInfo = {
	key: 'in-progress' | 'downloading' | 'importing' | 'finished' | 'failed';
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
				message: __( 'Pulling changes…' ),
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
				message: __( 'Backup imported' ),
			},
			failed: {
				key: 'failed',
				progress: 100,
				message: __( 'Failed to import backup' ),
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

	const isKeyFinished = ( key: PullStateProgressInfo[ 'key' ] | undefined ) => {
		return key === pullStatesProgressInfo.finished.key;
	};

	const isKeyFailed = ( key: PullStateProgressInfo[ 'key' ] | undefined ) => {
		return key === pullStatesProgressInfo.failed.key;
	};

	return { pullStatesProgressInfo, isKeyPulling, isKeyFinished, isKeyFailed };
}
