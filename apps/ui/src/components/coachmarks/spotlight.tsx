import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { makeSpotlightPath } from './spotlight-path';
import styles from './style.module.css';
import type { TrackedRect } from './use-anchor-rect';

interface SpotlightProps {
	// Current on-screen rect of the target, tracked each frame; null hides the
	// hole (a plain dim, or nothing when not dimmed).
	rect: TrackedRect | null;
	radius?: number;
	padding?: number;
	// Tours dim the background; lighter checklist/event coachmarks don't.
	dimmed?: boolean;
	// When set, clicking the dimmed area invokes this (tour dismissal).
	onClickOverlay?: () => void;
}

function useViewport() {
	const [ viewport, setViewport ] = useState( () => ( {
		width: window.innerWidth,
		height: window.innerHeight,
	} ) );
	useEffect( () => {
		const onResize = () => setViewport( { width: window.innerWidth, height: window.innerHeight } );
		window.addEventListener( 'resize', onResize );
		return () => window.removeEventListener( 'resize', onResize );
	}, [] );
	return viewport;
}

export function Spotlight( {
	rect,
	radius = 10,
	padding = 6,
	dimmed = true,
	onClickOverlay,
}: SpotlightProps ) {
	const viewport = useViewport();

	if ( ! dimmed ) {
		// Lighter coachmarks skip the scrim entirely; the ring the target gets
		// comes from the card's arrow + the popover, not an overlay.
		return null;
	}

	const hole = rect
		? {
				x: rect.x - padding,
				y: rect.y - padding,
				width: rect.width + padding * 2,
				height: rect.height + padding * 2,
		  }
		: null;

	const d = makeSpotlightPath( viewport, hole, radius );
	const interactive = Boolean( onClickOverlay );

	return createPortal(
		<svg
			className={ styles.spotlight }
			width={ viewport.width }
			height={ viewport.height }
			viewBox={ `0 0 ${ viewport.width } ${ viewport.height }` }
			aria-hidden="true"
		>
			<path
				className={ styles.spotlightPath }
				d={ d }
				fillRule="evenodd"
				style={ { pointerEvents: interactive ? 'auto' : 'none' } }
				onClick={ onClickOverlay }
			/>
		</svg>,
		document.body
	);
}
