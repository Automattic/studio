import { _n, sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { intervalToDuration, formatDuration, addDays, Duration, addHours } from 'date-fns';

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;

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
	let isExpired = true;
	let format: ( keyof Duration )[] = [ 'days', 'hours' ];
	if ( difference < 0 ) {
		isExpired = true;
	} else if ( difference < HOUR ) {
		format = [ 'minutes' ];
	} else if ( difference < DAY ) {
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
			locale: {
				formatDistance: ( token, count ) => {
					let stringToFormat = '';
					switch ( token ) {
						case 'xDays':
							stringToFormat = _n( '%d day', '%d days', count );
							break;
						case 'xHours':
							stringToFormat = _n( '%d hour', '%d hours', count );
							break;
						case 'xMinutes':
							stringToFormat = _n( '%d minute', '%d minutes', count );
							break;
					}
					return sprintf( stringToFormat, count );
				},
			},
		}
	);

	return {
		isExpired,
		countDown: isExpired ? __( 'Expired' ) : countDown,
		dateString: formatStringDate( snapshotDate ),
	};
}
