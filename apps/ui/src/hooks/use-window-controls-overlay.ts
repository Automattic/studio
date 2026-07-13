import { useEffect, useState } from 'react';

export interface WindowControlsOverlayGeometry {
	height: number;
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
	const controlsWidth = Math.max( rect.x, window.innerWidth - rect.right );
	return { height: rect.height, controlsWidth };
}

export function useWindowControlsOverlay(): WindowControlsOverlayGeometry | null {
	const [ geometry, setGeometry ] = useState< WindowControlsOverlayGeometry | null >(
		readGeometry
	);

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
