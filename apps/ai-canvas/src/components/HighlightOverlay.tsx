import type { HighlightRect } from '../lib/types';

interface HighlightOverlayProps {
	rect: HighlightRect | null;
}

export function HighlightOverlay( { rect }: HighlightOverlayProps ) {
	if ( ! rect ) {
		return null;
	}

	return (
		<div
			style={ {
				position: 'fixed',
				pointerEvents: 'none',
				top: rect.top,
				left: rect.left,
				width: rect.width,
				height: rect.height,
				border: '2px solid #3858e9',
				backgroundColor: 'rgba(56, 88, 233, 0.08)',
				borderRadius: 3,
				zIndex: 2147483646,
				transition: 'top 0.05s, left 0.05s, width 0.05s, height 0.05s',
			} }
		/>
	);
}
