import { __ } from '@wordpress/i18n';
import styles from './style.module.css';

function relativeTime( timestamp: number, now: number ) {
	const minutes = Math.max( 0, Math.floor( ( now - timestamp ) / 60_000 ) );
	if ( minutes === 0 ) {
		return __( 'Just now' );
	}
	const format = new Intl.RelativeTimeFormat( undefined, { numeric: 'auto', style: 'short' } );
	if ( minutes < 60 ) {
		return format.format( -minutes, 'minute' );
	}
	return minutes < 1440
		? format.format( -Math.floor( minutes / 60 ), 'hour' )
		: format.format( -Math.floor( minutes / 1440 ), 'day' );
}

export function NoticeTime( { timestamp, now }: { timestamp: number; now: number } ) {
	return (
		<time
			className={ styles.time }
			dateTime={ new Date( timestamp ).toISOString() }
			title={ new Date( timestamp ).toLocaleString() }
		>
			{ relativeTime( timestamp, now ) }
		</time>
	);
}
