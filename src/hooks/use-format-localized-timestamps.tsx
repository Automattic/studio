import { Duration, intervalToDuration } from 'date-fns';
import { useCallback } from 'react';
import { formatDistance } from '../lib/date';

function formatTimeDistance( duration: Duration ): string {
	if ( duration.days && duration.days > 0 ) {
		return formatDistance( 'xDays', duration.days );
	} else if ( duration.hours && duration.hours > 0 ) {
		return formatDistance( 'xHours', duration.hours );
	} else if ( duration.minutes && duration.minutes > 0 ) {
		return formatDistance( 'xMinutes', duration.minutes );
	} else {
		return formatDistance( 'xMinutes', 1 );
	}
}

export function useFormatLocalizedTimestamps() {
	const formatRelativeTime = useCallback( ( timestamp: string | null ): string => {
		if ( timestamp === null ) {
			return '';
		}

		const duration = intervalToDuration( {
			start: new Date( timestamp ),
			end: new Date(),
		} );

		return formatTimeDistance( duration );
	}, [] );

	return { formatRelativeTime };
}

export { formatTimeDistance };
