import { useEffect, useState } from 'react';
import styles from './style.module.css';

export const ROLL_ANIMATION_MS = 240;

// "12s", then "1m 05s", then "1h 02m 05s" — seconds always visible so the
// counter keeps ticking no matter how long a run gets.
export function formatElapsedTime( totalSeconds: number ): string {
	const hours = Math.floor( totalSeconds / 3600 );
	const minutes = Math.floor( ( totalSeconds % 3600 ) / 60 );
	const seconds = totalSeconds % 60;
	const pad = ( value: number ) => String( value ).padStart( 2, '0' );
	if ( hours > 0 ) {
		return `${ hours }h ${ pad( minutes ) }m ${ pad( seconds ) }s`;
	}
	if ( minutes > 0 ) {
		return `${ minutes }m ${ pad( seconds ) }s`;
	}
	return `${ seconds }s`;
}

// One character cell of the odometer: when its character changes, the old
// one rolls up and out while the new one rolls in from below.
export function RollingChar( { char }: { char: string } ) {
	const [ chars, setChars ] = useState( { current: char, previous: null as string | null } );

	// Derived-state-during-render: capture the outgoing character the moment
	// the prop changes so both can animate through the same frame.
	if ( chars.current !== char ) {
		setChars( { current: char, previous: chars.current } );
	}

	useEffect( () => {
		if ( chars.previous === null ) {
			return;
		}
		const timeout = window.setTimeout(
			() => setChars( ( value ) => ( { ...value, previous: null } ) ),
			ROLL_ANIMATION_MS
		);
		return () => window.clearTimeout( timeout );
	}, [ chars ] );

	return (
		<span className={ styles.rollCell }>
			{ chars.previous !== null ? (
				<span key={ `out-${ chars.previous }` } className={ styles.rollOut }>
					{ chars.previous }
				</span>
			) : null }
			<span
				key={ `in-${ chars.current }` }
				className={ chars.previous !== null ? styles.rollIn : undefined }
			>
				{ chars.current }
			</span>
		</span>
	);
}

export function RollingText( { text }: { text: string } ) {
	return (
		<span className={ styles.rollingText } aria-hidden="true">
			{ text
				.split( '' )
				.map( ( char, index ) =>
					char === ' ' ? (
						<span key={ text.length - index }>&nbsp;</span>
					) : (
						<RollingChar key={ text.length - index } char={ char } />
					)
				) }
		</span>
	);
}
