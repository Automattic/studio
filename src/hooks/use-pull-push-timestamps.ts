import { __, sprintf } from '@wordpress/i18n';
import { formatDistanceToNow } from 'date-fns';
import { useCallback } from 'react';

interface ConnectedSite {
	id: number;
	localSiteId: string;
	lastPullTimestamp: number | null;
	lastPushTimestamp: number | null;
}

export function usePullPushTimestamps() {
	const getLastSyncTimeWithType = useCallback(
		( site: ConnectedSite, type: 'pull' | 'push' ): string => {
			const timestamp = type === 'pull' ? site.lastPullTimestamp : site.lastPushTimestamp;

			if ( timestamp === null ) {
				return type === 'pull'
					? __( 'You have not pulled this site yet.' )
					: __( 'You have not pushed this site yet.' );
			}

			// return sprintf(
			// 	type === 'pull'
			// 		? __( 'You pulled this site %s ago.' )
			// 		: __( 'You pushed this site %s ago.' ),
			// 	formatDistanceToNow( new Date( timestamp ) )
			// );
		},
		[]
	);

	return { getLastSyncTimeWithType };
}
