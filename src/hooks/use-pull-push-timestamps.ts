import { __, sprintf } from '@wordpress/i18n';
import { formatDistanceToNow } from 'date-fns';
import { useCallback, useState, useEffect } from 'react';

const SYNC_TIMESTAMPS_STORAGE_KEY = 'wp-studio-sync-timestamps';

interface SyncTimestamps {
	[ localSiteId: string ]: {
		[ connectedSiteId: number ]: {
			pull?: number;
			push?: number;
		};
	};
}

export function usePullPushTimestamps() {
	const [ timestamps, setTimestamps ] = useState< SyncTimestamps >( () => {
		try {
			const stored = localStorage.getItem( SYNC_TIMESTAMPS_STORAGE_KEY );
			return stored ? JSON.parse( stored ) : {};
		} catch ( e ) {
			console.error( 'Failed to parse sync timestamps:', e );
			return {};
		}
	} );

	useEffect( () => {
		try {
			localStorage.setItem( SYNC_TIMESTAMPS_STORAGE_KEY, JSON.stringify( timestamps ) );
		} catch ( e ) {
			console.error( 'Failed to save sync timestamps:', e );
		}
	}, [ timestamps ] );

	const updateTimestamp = useCallback(
		( localSiteId: string, connectedSiteId: number, type: 'pull' | 'push' ) => {
			setTimestamps( ( prev ) => {
				const newTimestamps = { ...prev };
				if ( ! newTimestamps[ localSiteId ] ) {
					newTimestamps[ localSiteId ] = {};
				}
				if ( ! newTimestamps[ localSiteId ][ connectedSiteId ] ) {
					newTimestamps[ localSiteId ][ connectedSiteId ] = {};
				}
				newTimestamps[ localSiteId ][ connectedSiteId ][ type ] = Date.now();
				return newTimestamps;
			} );
		},
		[]
	);

	const getLastSyncTimeWithType = useCallback(
		( localSiteId: string, connectedSiteId: number, type: 'pull' | 'push' ): string => {
			const localSiteTimestamps = timestamps[ localSiteId ] || {};
			const siteTimestamps = localSiteTimestamps[ connectedSiteId ] || {};
			const timestamp = siteTimestamps[ type ];

			if ( ! timestamp ) {
				return type === 'pull'
					? __( 'You have not pulled this site yet.' )
					: __( 'You have not pushed this site yet.' );
			}

			return sprintf(
				type === 'pull'
					? __( 'You pulled this site %s ago.' )
					: __( 'You pushed this site %s ago.' ),
				formatDistanceToNow( timestamp )
			);
		},
		[ timestamps ]
	);

	const clearTimestamps = useCallback( ( localSiteId: string, connectedSiteId: number ) => {
		setTimestamps( ( prev ) => {
			const newTimestamps = { ...prev };
			if ( newTimestamps[ localSiteId ] ) {
				delete newTimestamps[ localSiteId ][ connectedSiteId ];
				if ( Object.keys( newTimestamps[ localSiteId ] ).length === 0 ) {
					delete newTimestamps[ localSiteId ];
				}
			}
			return newTimestamps;
		} );
	}, [] );

	return {
		updateTimestamp,
		getLastSyncTimeWithType,
		clearTimestamps,
	};
}
