import { useI18n } from '@wordpress/react-i18n';
import { intervalToDuration, formatDuration, addDays, Duration, addHours } from 'date-fns';
import { HOUR_MS, DAY_MS } from '../constants';
import { formatDistance } from '../lib/date';

function formatStringDate( ms: number ): string {
	const { locale = 'en' } = window?.appGlobals || {};
	const formatter = new Intl.DateTimeFormat( locale, {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	} );
	return formatter.format( new Date( ms ) );
}

export function useExpirationDate( snapshotDate: number ) {
	const { __ } = useI18n();
	const MAX_DAYS = 7;
	const now = new Date();
	const endDate = addDays( snapshotDate, MAX_DAYS );
	const difference = endDate.getTime() - now.getTime();
	let isExpired = false;
	let format: ( keyof Duration )[] = [ 'days', 'hours' ];
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
		dateString: formatStringDate( snapshotDate ),
	};
}
