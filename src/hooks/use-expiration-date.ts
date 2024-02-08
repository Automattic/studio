import { useI18n } from '@wordpress/react-i18n';
import { intervalToDuration, formatDuration, addDays, Duration } from 'date-fns';

export function useExpirationDate( snapshotDate: number ) {
	const { __ } = useI18n();
	const MAX_DAYS = 7;
	const now = new Date();
	const difference = addDays( snapshotDate, MAX_DAYS ).getTime() - now.getTime();
	let isExpired = false;
	let format: ( keyof Duration )[] = [ 'days', 'hours' ];
	if ( difference < 0 ) {
		isExpired = true;
	} else if ( difference < 1000 * 60 * 60 ) {
		format = [ 'minutes' ];
	} else if ( difference < 1000 * 60 * 60 * 24 ) {
		format = [ 'hours', 'minutes' ];
	}
	const countDown = formatDuration(
		intervalToDuration( {
			start: now,
			end: addDays( snapshotDate, MAX_DAYS ),
		} ),
		{ format, delimiter: ', ' }
	);
	return {
		isExpired,
		countDown: isExpired ? __( 'Expired' ) : countDown,
	};
}
