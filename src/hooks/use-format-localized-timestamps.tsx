import { Duration, intervalToDuration } from 'date-fns';
import { useCallback } from 'react';
import { formatDistance } from '../lib/date';
import { SupportedLocale } from '../lib/locale';
import { useI18nData } from './use-i18n-data';

function formatTimeDistance( duration: Duration, _locale: SupportedLocale ): string {
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
	const { locale } = useI18nData();

	const formatRelativeTime = useCallback(
		( timestamp: string | null ): string => {
			if ( timestamp === null ) {
				return '';
			}

			const duration = intervalToDuration( {
				start: new Date( timestamp ),
				end: new Date(),
			} );

			return formatTimeDistance( duration, locale );
		},
		[ locale ]
	);

	return { formatRelativeTime };
}

export { formatTimeDistance };
