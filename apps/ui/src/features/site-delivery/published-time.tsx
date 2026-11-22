import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { useUserLocale } from '@/data/queries/use-user-locale';
import styles from './style.module.css';

export function PublishedTime( { timestamp }: { timestamp: string } ) {
	const locale = useUserLocale();
	const [ now, setNow ] = useState( Date.now );
	useEffect( () => {
		const timer = setInterval( () => setNow( Date.now() ), 60_000 );
		return () => clearInterval( timer );
	}, [] );
	const date = new Date( timestamp );
	if ( Number.isNaN( date.getTime() ) ) return null;
	const today = new Date( now );
	const minutes = Math.floor( ( now - date.getTime() ) / 60_000 );
	let label: string;
	if ( date.toDateString() !== today.toDateString() ) {
		const day = date.toLocaleDateString( locale, {
			month: 'short',
			day: 'numeric',
			year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
		} );
		/* translators: %s is the date of the last publish from Studio, e.g. Nov 18. */
		label = sprintf( __( 'Last updated on %s' ), day );
	} else if ( minutes < 1 ) {
		label = __( 'Last updated just now' );
	} else {
		const formatter = new Intl.RelativeTimeFormat( locale, { numeric: 'always' } );
		const elapsed =
			minutes < 60
				? formatter.format( -minutes, 'minute' )
				: formatter.format( -Math.floor( minutes / 60 ), 'hour' );
		/* translators: %s is a relative time, e.g. 5 minutes ago. */
		label = sprintf( __( 'Last updated %s' ), elapsed );
	}
	return (
		<time
			className={ styles.footerNote }
			dateTime={ date.toISOString() }
			title={ date.toLocaleString( locale ) }
		>
			{ label }
		</time>
	);
}
