import { useEffect, useState } from 'react';

interface AppZoomWindow extends Window {
	ipcApi?: { getAppZoomFactor?: () => number };
}

// Only the Electron preload exposes the renderer's zoom factor. In a browser
// the app never zooms the page itself, so the factor is 1.
function readAppZoomFactor(): number {
	if ( typeof window === 'undefined' ) {
		return 1;
	}
	const factor = ( window as AppZoomWindow ).ipcApi?.getAppZoomFactor?.();
	return typeof factor === 'number' && Number.isFinite( factor ) && factor > 0 ? factor : 1;
}

/**
 * The factor the app UI is zoomed by (1 at "Actual Size").
 *
 * Zooming the page resizes its layout viewport, which fires `resize`; that's
 * the cue to re-read it.
 */
export function useAppZoomFactor(): number {
	const [ zoomFactor, setZoomFactor ] = useState( readAppZoomFactor );

	useEffect( () => {
		const update = () => setZoomFactor( readAppZoomFactor() );
		update();
		window.addEventListener( 'resize', update );
		return () => window.removeEventListener( 'resize', update );
	}, [] );

	return zoomFactor;
}
