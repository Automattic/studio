import { __ } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { useUserLocale } from '@/data/queries/use-user-locale';

export function RelativeTime( {
	timestamp,
	active,
	compact = false,
	formatLabel,
}: {
	timestamp: string | number;
	active: boolean;
	compact?: boolean;
	formatLabel?: ( label: string ) => string;
} ) {
	const locale = useUserLocale();
	const [ now, setNow ] = useState( Date.now );
	useEffect( () => {
		if ( ! active ) return;
		setNow( Date.now() );
		const timer = setInterval( () => setNow( Date.now() ), 60_000 );
		return () => clearInterval( timer );
	}, [ active ] );
	const date = new Date( timestamp );
	if ( Number.isNaN( date.getTime() ) ) return null;
	const minutes = Math.max( 0, Math.floor( ( now - date.getTime() ) / 60_000 ) );
	const formatter = new Intl.RelativeTimeFormat( locale, {
		numeric: compact ? 'always' : 'auto',
		style: compact ? 'narrow' : 'long',
	} );
	const label =
		minutes === 0
			? compact
				? __( 'just now' )
				: __( 'Just now' )
			: minutes < 60
			? formatter.format( -minutes, 'minute' )
			: minutes < 1440
			? formatter.format( -Math.floor( minutes / 60 ), 'hour' )
			: formatter.format( -Math.floor( minutes / 1440 ), 'day' );
	return (
		<time dateTime={ date.toISOString() } title={ date.toLocaleString( locale ) }>
			{ formatLabel ? formatLabel( label ) : label }
		</time>
	);
}
