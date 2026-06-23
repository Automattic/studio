import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * Wires the mouse's back/forward side buttons (buttons 3 and 4) to router
 * history. Electron doesn't translate these into navigation on its own the
 * way browsers do, so without this they're dead clicks.
 */
export function useMouseNavigation(): void {
	const router = useRouter();

	useEffect( () => {
		const handleMouseUp = ( event: MouseEvent ) => {
			if ( event.button === 3 ) {
				event.preventDefault();
				router.history.back();
			} else if ( event.button === 4 ) {
				event.preventDefault();
				router.history.forward();
			}
		};
		window.addEventListener( 'mouseup', handleMouseUp );
		return () => window.removeEventListener( 'mouseup', handleMouseUp );
	}, [ router ] );
}
