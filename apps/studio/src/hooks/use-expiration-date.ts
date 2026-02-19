import { HOUR_MS, DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { SupportedLocale } from '@studio/common/lib/locale';
import { useI18n } from '@wordpress/react-i18n';
import { intervalToDuration, formatDuration, addDays, DurationUnit, addHours } from 'date-fns';
import { formatDistance } from 'src/lib/date';
import { useI18nLocale } from 'src/stores';

type FormatKey = 'short' | 'long';

function formatStringDate(
	ms: number,
	locale: SupportedLocale,
	format: FormatKey = 'short'
): string {
	const options: Record< FormatKey, Intl.DateTimeFormatOptions > = {
		short: {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		},
		long: {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		},
	};
	const formatter = new Intl.DateTimeFormat( locale, options[ format ] );
	return formatter.format( new Date( ms ) );
}

export function useExpirationDate( snapshotDate: number ) {
	const { __ } = useI18n();
	const locale = useI18nLocale();
	const now = new Date();
	const endDate = addDays( snapshotDate, DEMO_SITE_EXPIRATION_DAYS );
	const difference = endDate.getTime() - now.getTime();
	let isExpired = false;
	let format: DurationUnit[] = [ 'days', 'hours' ];
	if ( difference < 0 ) {
		isExpired = true;
	} else if ( difference < HOUR_MS ) {
		format = [ 'minutes' ];
	} else if ( difference < DAY_MS ) {
		format = [ 'hours', 'minutes' ];
	}
	const countDown = formatDuration(
		intervalToDuration( {
			start: now,
			// Add 1 hour to the end date serves us here, as for the last hour
			// we show the minutes left.
			end: addHours( endDate, 1 ),
		} ),
		{
			format,
			delimiter: ', ',
			locale: { formatDistance },
		}
	);

	return {
		isExpired,
		countDown: isExpired ? __( 'Expired' ) : countDown,
		expireDateString: formatStringDate( endDate.getTime(), locale, 'long' ),
		dateString: formatStringDate( snapshotDate, locale, 'long' ),
	};
}
