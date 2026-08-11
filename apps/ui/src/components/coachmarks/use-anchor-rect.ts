import { useEffect, useState } from 'react';

export interface TrackedRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

function sameRect( a: TrackedRect | null, b: TrackedRect ): boolean {
	return !! a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Tracks an element's viewport rect with a requestAnimationFrame loop. A loop
 * (rather than Resize/Intersection observers) transparently follows sidebar
 * and preview-split resize drags, window resizes, and Electron webview reflows
 * with no observer bookkeeping. Only runs while an element is passed, i.e.
 * while a coachmark is showing.
 */
export function useAnchorRect( element: HTMLElement | null ): TrackedRect | null {
	const [ rect, setRect ] = useState< TrackedRect | null >( null );

	useEffect( () => {
		if ( ! element ) {
			setRect( null );
			return;
		}
		let raf = 0;
		const tick = () => {
			const domRect = element.getBoundingClientRect();
			const next: TrackedRect = {
				x: domRect.x,
				y: domRect.y,
				width: domRect.width,
				height: domRect.height,
			};
			setRect( ( prev ) => ( sameRect( prev, next ) ? prev : next ) );
			raf = requestAnimationFrame( tick );
		};
		raf = requestAnimationFrame( tick );
		return () => cancelAnimationFrame( raf );
	}, [ element ] );

	return rect;
}
