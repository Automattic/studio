import { useEffect } from 'react';

export function useWindowListener(
	type: keyof WindowEventMap,
	callback: Parameters< typeof window.addEventListener >[ 1 ]
) {
	useEffect( () => {
		window.addEventListener( type, callback );
		return () => {
			window.removeEventListener( type, callback );
		};
	}, [ callback, type ] );
}
