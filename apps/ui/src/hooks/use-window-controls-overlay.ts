import { useEffect, useState } from 'react';

export interface WindowControlsOverlayGeometry {
	/** Height the OS reserved for the controls (and drag area), in CSS pixels. */
	height: number;
	/** Width of the controls to clear on the inline-end edge, in CSS pixels. */
	controlsWidth: number;
}

interface WindowControlsOverlayLike {
	visible: boolean;
	getTitlebarAreaRect(): DOMRect;
	addEventListener( type: 'geometrychange', listener: () => void ): void;
	removeEventListener( type: 'geometrychange', listener: () => void ): void;
}

function getOverlay(): WindowControlsOverlayLike | undefined {
	return ( navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike } )
		.windowControlsOverlay;
}

function readGeometry(): WindowControlsOverlayGeometry | null {
	const overlay = getOverlay();
	if ( ! overlay?.visible ) {
		return null;
	}
	const rect = overlay.getTitlebarAreaRect();
	// The titlebar area excludes the controls, which sit on the inline-end side
	// (right in LTR, left in RTL). Either the left gap (rect.x) or the right gap
	// is the controls' width.
	const controlsWidth = Math.max( rect.x, window.innerWidth - rect.right );
	return { height: rect.height, controlsWidth };
}

/**
 * Geometry of the native window-controls overlay (min/max/close) that the
 * desktop app draws over the content on Windows/Linux. Returns null when no
 * overlay is present (macOS, fullscreen, or a browser), so callers reserve
 * space only when real controls exist — no platform sniffing needed. Values are
 * reported by the OS, so they stay correct across desktop environments.
 */
export function useWindowControlsOverlay(): WindowControlsOverlayGeometry | null {
	const [ geometry, setGeometry ] = useState< WindowControlsOverlayGeometry | null >( readGeometry );

	useEffect( () => {
		const overlay = getOverlay();
		if ( ! overlay ) {
			return;
		}
		const update = () => setGeometry( readGeometry() );
		overlay.addEventListener( 'geometrychange', update );
		window.addEventListener( 'resize', update );
		return () => {
			overlay.removeEventListener( 'geometrychange', update );
			window.removeEventListener( 'resize', update );
		};
	}, [] );

	return geometry;
}
