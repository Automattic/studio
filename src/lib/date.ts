import { __, _n, sprintf } from '@wordpress/i18n';
import { FormatDistanceFn } from 'date-fns';

export type TimeFormat = 'short' | 'long';

/**
 * This function is meant to be used mainly in date-fns function `formatDuration`
 * and in our `formatTimeDistance` to obtain localized distance strings.
 *
 * @param token
 * @param count
 * @returns localized distance string in long format
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

/**
 * This function is meant to be used mainly in date-fns function `formatDuration`
 * and in our `formatTimeDistance` to obtain localized distance strings.
 *
 * @param token
 * @param count
 * @returns localized distance string in short format
 */
export const formatDistanceShort: FormatDistanceFn = ( token, count ) => {
	let stringToFormat = '';
	switch ( token ) {
		case 'xDays':
			stringToFormat = _n( '%d d', '%d d', count );
			break;
		case 'xHours':
			stringToFormat = _n( '%d h', '%d h', count );
			break;
		case 'xMinutes':
			stringToFormat = _n( '%d min', '%d min', count );
			break;
	}
	return sprintf( stringToFormat, count );
};
