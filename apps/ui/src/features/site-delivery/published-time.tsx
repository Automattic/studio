import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import { useUserLocale } from '@/data/queries/use-user-locale';

export function PublishedTime( { timestamp }: { timestamp: string } ) {
	const locale = useUserLocale();
	const [ now, setNow ] = useState( Date.now );
	useEffect( () => {
		const timer = setInterval( () => setNow( Date.now() ), 60_000 );
		return () => clearInterval( timer );
	}, [] );
	const date = new Date( timestamp );
	if ( Number.isNaN( date.getTime() ) ) return null;
	const minutes = Math.max( 0, Math.floor( ( now - date.getTime() ) / 60_000 ) );
	const formatter = new Intl.RelativeTimeFormat( locale, { numeric: 'always' } );
	const label =
		minutes === 0
			? __( 'Published just now' )
			: sprintf(
					__( 'Published %s' ),
					minutes < 60
						? formatter.format( -minutes, 'minute' )
						: minutes < 1440
						? formatter.format( -Math.floor( minutes / 60 ), 'hour' )
						: date.toLocaleDateString( locale, {
								month: 'short',
								day: 'numeric',
								...( date.getFullYear() !== new Date( now ).getFullYear()
									? { year: 'numeric' }
									: {} ),
						  } )
			  );
	return (
		<time dateTime={ date.toISOString() } title={ date.toLocaleString( locale ) }>
			{ label }
		</time>
	);
}
