import { _n, sprintf } from '@wordpress/i18n';
import { FormatDistanceFn } from 'date-fns';

/**
 * This function is meant to be used mainly in date-fns function `formatDuration`
 * to obtain localized distance strings.
 *
 * @param token
 * @param count
 * @returns localized distance string
 */
export const formatDistance: FormatDistanceFn = ( token, count ) => {
	switch ( token ) {
		case 'xDays':
			return sprintf( _n( '%d day', '%d days', count ), count );
		case 'xHours':
			return sprintf( _n( '%d hour', '%d hours', count ), count );
		case 'xMinutes':
			return sprintf( _n( '%d minute', '%d minutes', count ), count );
	}
	return '';
};
