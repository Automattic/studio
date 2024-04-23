import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { intervalToDuration, formatDuration, addDays, Duration, addHours } from 'date-fns';

const HOUR = 1000 * 60 * 60;
const DAY = HOUR * 24;
const DURATION_DAYS = 'days';
const DURATION_HOURS = 'hours';
const DURATION_MINUTES = 'minutes';

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
	let format: ( keyof Duration )[] = [ DURATION_DAYS, DURATION_HOURS ]; // Keys for logic
	if ( difference < 0 ) {
		isExpired = true;
	} else if ( difference < HOUR ) {
		format = [ DURATION_MINUTES ];
	} else if ( difference < DAY ) {
		format = [ DURATION_HOURS, DURATION_MINUTES ];
	}
	const countDown = formatDuration(
		intervalToDuration( {
			start: now,
			// Add 1 hour to the end date serves us here, as for the last hour
			// we show the minutes left.
			end: addHours( endDate, 1 ),
		} ),
		{ format, delimiter: ', ' }
	);
	// Translate here for display purposes, not in the logic configuration
	const translatedCountDown = countDown
		.replace( 'days', __( DURATION_DAYS ) )
		.replace( 'hours', __( DURATION_HOURS ) )
		.replace( 'minutes', __( DURATION_MINUTES ) );

	return {
		isExpired,
		countDown: isExpired ? __( 'Expired' ) : translatedCountDown,
		dateString: formatStringDate( snapshotDate ),
	};
}
