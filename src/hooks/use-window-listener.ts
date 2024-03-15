import { useEffect } from 'react';

export function useWindowListener( type: keyof WindowEventMap, callback: () => void ) {
	useEffect( () => {
		window.addEventListener( type, callback );
		return () => {
			window.removeEventListener( type, callback );
		};
	}, [ callback, type ] );
}
