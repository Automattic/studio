import { __, _n, sprintf } from '@wordpress/i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime( iso: string ): string {
	const now = Date.now();
	const then = Date.parse( iso );
	if ( Number.isNaN( then ) ) {
		return '';
	}
	const diff = Math.max( 0, now - then );

	if ( diff < MINUTE ) {
		return __( 'just now' );
	}
	if ( diff < HOUR ) {
		const minutes = Math.floor( diff / MINUTE );
		return sprintf(
			/* translators: %d: minutes */
			_n( '%dm ago', '%dm ago', minutes ),
			minutes
		);
	}
	if ( diff < DAY ) {
		const hours = Math.floor( diff / HOUR );
		return sprintf(
			/* translators: %d: hours */
			_n( '%dh ago', '%dh ago', hours ),
			hours
		);
	}
	if ( diff < 2 * DAY ) {
		return __( 'yesterday' );
	}
	const days = Math.floor( diff / DAY );
	return sprintf(
		/* translators: %d: days */
		_n( '%d day ago', '%d days ago', days ),
		days
	);
}
