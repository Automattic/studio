import { useEffect, useState } from 'react';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import styles from './style.module.css';

const ROLL_ANIMATION_MS = 240;

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
function RollingChar( { char }: { char: string } ) {
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

function ElapsedTime( { seconds }: { seconds: number } ) {
	const text = formatElapsedTime( seconds );
	return (
		<span className={ styles.elapsed } aria-hidden="true">
			{ text.split( '' ).map( ( char, index ) =>
				// Key from the string's end so cells keep their meaning when the
				// format grows ("59s" → "1m 00s"): the trailing "s" and seconds
				// digits stay put and only the new prefix rolls in.
				char === ' ' ? (
					<span key={ text.length - index }>&nbsp;</span>
				) : (
					<RollingChar key={ text.length - index } char={ char } />
				)
			) }
		</span>
	);
}

export function ThinkingIndicator( {
	active,
	startedAt,
	progressMessage,
}: {
	active: boolean;
	startedAt: number | null;
	progressMessage: string | null;
} ) {
	const [ elapsedSeconds, setElapsedSeconds ] = useState( 0 );

	useEffect( () => {
		if ( ! active || startedAt === null ) {
			return;
		}
		setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		const tickInterval = window.setInterval( () => {
			setElapsedSeconds( Math.floor( ( Date.now() - startedAt ) / 1000 ) );
		}, 1000 );
		return () => {
			window.clearInterval( tickInterval );
		};
	}, [ active, startedAt ] );

	return (
		<div className={ styles.root }>
			{ active ? (
				<>
					<div className={ styles.head }>
						<AgentWorkingIndicator className={ styles.pixels } />
						{ /* Hidden from assistive tech so the tick doesn't announce
						     every second; the pixel grid's status label covers it. */ }
						{ elapsedSeconds > 0 ? <ElapsedTime seconds={ elapsedSeconds } /> : null }
					</div>
					{ progressMessage ? (
						<span className={ styles.progress }>{ progressMessage }</span>
					) : null }
				</>
			) : null }
		</div>
	);
}
