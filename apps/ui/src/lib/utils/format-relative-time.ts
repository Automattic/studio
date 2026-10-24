import { __, sprintf } from '@wordpress/i18n';

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
		return __( 'now' );
	}
	if ( diff < HOUR ) {
		const minutes = Math.floor( diff / MINUTE );
		/* translators: %d: number of minutes, compact relative time (e.g. "2m") */
		return sprintf( __( '%dm' ), minutes );
	}
	if ( diff < DAY ) {
		const hours = Math.floor( diff / HOUR );
		/* translators: %d: number of hours, compact relative time (e.g. "2h") */
		return sprintf( __( '%dh' ), hours );
	}
	const days = Math.floor( diff / DAY );
	/* translators: %d: number of days, compact relative time (e.g. "2d") */
	return sprintf( __( '%dd' ), days );
}
