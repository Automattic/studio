import { useI18n } from '@wordpress/react-i18n';
import { useMemo } from 'react';

export type PullStateProgressInfo = {
	key:
		| 'in-progress'
		| 'backup-sync-downloading'
		| 'backup-sync-importing'
		| 'backup-sync-finished'
		| 'failed';
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
			// Backup completed on server, downloading on client
			completed: {
				key: 'backup-sync-downloading',
				progress: 60,
				message: __( 'Downloading backup…' ),
			},
			importing: {
				key: 'backup-sync-importing',
				progress: 80,
				message: __( 'Importing backup…' ),
			},
			finished: {
				key: 'backup-sync-finished',
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

	return pullStatesProgressInfo;
}
