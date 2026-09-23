import { useEffect, useRef } from 'react';

const KONAMI_SEQUENCE = [
	'ArrowUp',
	'ArrowUp',
	'ArrowDown',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowLeft',
	'ArrowRight',
	'b',
	'a',
];

const RESET_TIMEOUT_MS = 2000;

// onActivate must be stable (useCallback) — this effect re-attaches the listener whenever it changes.
export function useKonamiCode( onActivate: () => void ) {
	const indexRef = useRef( 0 );
	const timerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	useEffect( () => {
		function resetSequence() {
			indexRef.current = 0;
			if ( timerRef.current !== null ) {
				clearTimeout( timerRef.current );
				timerRef.current = null;
			}
		}

		function handleKeyDown( e: KeyboardEvent ) {
			const expected = KONAMI_SEQUENCE[ indexRef.current ];
			if ( e.key === expected ) {
				indexRef.current += 1;
				if ( indexRef.current === KONAMI_SEQUENCE.length ) {
					resetSequence();
					onActivate();
					return;
				}
				// Reset the sequence if no key is pressed within the time window
				if ( timerRef.current !== null ) clearTimeout( timerRef.current );
				timerRef.current = setTimeout( resetSequence, RESET_TIMEOUT_MS );
			} else {
				resetSequence();
				if ( e.key === KONAMI_SEQUENCE[ 0 ] ) {
					indexRef.current = 1;
					timerRef.current = setTimeout( resetSequence, RESET_TIMEOUT_MS );
				}
			}
		}

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
			if ( timerRef.current !== null ) clearTimeout( timerRef.current );
		};
	}, [ onActivate ] );
}
