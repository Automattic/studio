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

export function useKonamiCode( onActivate: () => void ) {
	const indexRef = useRef( 0 );

	useEffect( () => {
		function handleKeyDown( e: KeyboardEvent ) {
			const expected = KONAMI_SEQUENCE[ indexRef.current ];
			if ( e.key === expected ) {
				indexRef.current += 1;
				if ( indexRef.current === KONAMI_SEQUENCE.length ) {
					indexRef.current = 0;
					onActivate();
				}
			} else {
				indexRef.current = e.key === KONAMI_SEQUENCE[ 0 ] ? 1 : 0;
			}
		}

		window.addEventListener( 'keydown', handleKeyDown );
		return () => window.removeEventListener( 'keydown', handleKeyDown );
	}, [ onActivate ] );
}
