import { __ } from '@wordpress/i18n';
import { formatDistanceToNow } from 'date-fns';
import { useCallback } from 'react';

const SYNC_TIMESTAMPS_STORAGE_KEY = 'wp-studio-sync-timestamps';

interface SyncTimestamps {
	[ localSiteId: string ]: {
		[ connectedSiteId: number ]: {
			lastPull?: number;
			lastPush?: number;
		};
	};
}

export function usePullPushTimestamps() {
	const getStoredTimestamps = useCallback( (): SyncTimestamps => {
		try {
			const stored = localStorage.getItem( SYNC_TIMESTAMPS_STORAGE_KEY );
			return stored ? JSON.parse( stored ) : {};
		} catch ( e ) {
			console.error( 'Failed to parse sync timestamps:', e );
			return {};
		}
	}, [] );

	const updateTimestamp = useCallback(
		( localSiteId: string, connectedSiteId: number, type: 'pull' | 'push' ) => {
			try {
				const timestamps = getStoredTimestamps();
				timestamps[ localSiteId ] = timestamps[ localSiteId ] || {};
				timestamps[ localSiteId ][ connectedSiteId ] = {
					...timestamps[ localSiteId ][ connectedSiteId ],
					[ type === 'pull' ? 'lastPull' : 'lastPush' ]: Date.now(),
				};
				localStorage.setItem( SYNC_TIMESTAMPS_STORAGE_KEY, JSON.stringify( timestamps ) );
			} catch ( e ) {
				console.error( 'Failed to update sync timestamp:', e );
			}
		},
		[ getStoredTimestamps ]
	);

	const getLastSyncTimeWithType = useCallback(
		( localSiteId: string, connectedSiteId: number, type: 'pull' | 'push' ): string => {
			const timestamps = getStoredTimestamps();
			const localSiteTimestamps = timestamps[ localSiteId ] || {};
			const siteTimestamps = localSiteTimestamps[ connectedSiteId ] || {};
			const timestamp = type === 'pull' ? siteTimestamps.lastPull : siteTimestamps.lastPush;

			if ( ! timestamp ) {
				return type === 'pull' ? __( 'Never pulled' ) : __( 'Never pushed' );
			}

			return type === 'pull'
				? __( 'Last pull %s ago', formatDistanceToNow( timestamp ) )
				: __( 'Last push %s ago', formatDistanceToNow( timestamp ) );
		},
		[ getStoredTimestamps ]
	);

	const clearTimestamps = useCallback(
		( localSiteId: string, connectedSiteId: number ) => {
			try {
				const timestamps = getStoredTimestamps();
				if ( timestamps[ localSiteId ] ) {
					delete timestamps[ localSiteId ][ connectedSiteId ];
					if ( Object.keys( timestamps[ localSiteId ] ).length === 0 ) {
						delete timestamps[ localSiteId ];
					}
					localStorage.setItem( SYNC_TIMESTAMPS_STORAGE_KEY, JSON.stringify( timestamps ) );
				}
			} catch ( e ) {
				console.error( 'Failed to clear sync timestamps:', e );
			}
		},
		[ getStoredTimestamps ]
	);

	return {
		updateTimestamp,
		getLastSyncTimeWithType,
		clearTimestamps,
	};
}
