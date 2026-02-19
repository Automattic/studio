import { __, sprintf } from '@wordpress/i18n';
import { useCallback } from 'react';
import { useFormatLocalizedTimestamps } from 'src/hooks/use-format-localized-timestamps';

export type GetLastSyncTimeText = ( timestamp: string | null, type: 'pull' | 'push' ) => string;

/**
 * Hook that returns a function to format the last sync time text.
 */
export function useLastSyncTimeText(): GetLastSyncTimeText {
	const { formatRelativeTime } = useFormatLocalizedTimestamps();

	return useCallback< GetLastSyncTimeText >(
		( timestamp, type ) => {
			if ( ! timestamp ) {
				return type === 'pull'
					? __( 'You have not pulled this site yet.' )
					: __( 'You have not pushed this site yet.' );
			}

			return sprintf(
				type === 'pull'
					? __( 'You pulled this site %s ago.' )
					: __( 'You pushed this site %s ago.' ),
				formatRelativeTime( timestamp )
			);
		},
		[ formatRelativeTime ]
	);
}
