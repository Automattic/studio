import styles from './style.module.css';
import type { OrientationIllustrationId } from '@/data/onboarding/orientation-guide';
import type { ReactNode } from 'react';

// The full-bleed header slot every illustration fills: a fixed aspect ratio so
// the popup header keeps a stable height, a positioning context for the scene,
// and clipping so animated elements can travel off-frame. Each scene owns its
// own background and (if it needs one) color-scheme scope.
export function Stage( { id, children }: { id: OrientationIllustrationId; children: ReactNode } ) {
	return (
		<div className={ styles.stage } data-illustration={ id }>
			{ children }
		</div>
	);
}

// A pointer used by scenes to demonstrate interactions. Movement and visibility
// are driven entirely by the scene's own keyframes via `className`, so the
// primitive stays dumb and reusable. The macOS pointer look — black fill with a
// thick, rounded white border — reads clearly on any background.
export function Cursor( { className }: { className?: string } ) {
	return (
		<svg
			className={ className }
			width="18"
			height="22"
			viewBox="0 0 20 25"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M3 2 L3 21 L8 16.5 L11 23 L14 21.8 L10.8 15.5 L17 15.3 Z"
				fill="#000"
				stroke="#fff"
				strokeWidth="2"
				strokeLinejoin="round"
				strokeLinecap="round"
				paintOrder="stroke"
			/>
		</svg>
	);
}
