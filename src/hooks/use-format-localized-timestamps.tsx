import { Duration, intervalToDuration } from 'date-fns';
import { useCallback } from 'react';
import { formatDistance, formatDistanceShort, TimeFormat } from 'src/lib/date';

function formatTimeDistance( duration: Duration, format: TimeFormat = 'long' ): string {
	const fn = format === 'short' ? formatDistanceShort : formatDistance;
	if ( duration.days && duration.days > 0 ) {
		return fn( 'xDays', duration.days );
	} else if ( duration.hours && duration.hours > 0 ) {
		return fn( 'xHours', duration.hours );
	} else if ( duration.minutes && duration.minutes > 0 ) {
		return fn( 'xMinutes', duration.minutes );
	} else {
		return fn( 'xMinutes', 1 );
	}
}

export function useFormatLocalizedTimestamps() {
	const formatRelativeTime = useCallback(
		( timestamp: string | null, format: TimeFormat = 'long' ): string => {
			if ( timestamp === null ) {
				return '';
			}

			const duration = intervalToDuration( {
				start: new Date( timestamp ),
				end: new Date(),
			} );

			return formatTimeDistance( duration, format );
		},
		[]
	);

	return { formatRelativeTime };
}

export { formatTimeDistance };
