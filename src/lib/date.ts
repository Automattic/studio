import { _n, sprintf } from '@wordpress/i18n';
import { intervalToDuration, FormatDistanceFn, formatDuration } from 'date-fns';

/**
 * This function is meant to be used mainly in date-fns function `formatDuration`
 * to obtain localized distance strings.
 *
 * @param token
 * @param count
 * @returns localized distance string
 */
export const formatDistance: FormatDistanceFn = ( token, count ) => {
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
};
