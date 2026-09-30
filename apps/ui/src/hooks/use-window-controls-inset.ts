import { createContext, useContext } from 'react';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import { useWindowControlsSurface } from '@/hooks/use-window-controls-surface';

/**
 * Whether the surrounding panel reaches the window's physical top-right corner,
 * where Windows/Linux paint the native window controls. Set by the layout that
 * knows where each panel sits (see PreviewSplitFrame).
 */
export const WindowControlsCornerContext = createContext( false );

/**
 * Width a header must leave free at its physical right so the Windows/Linux
 * window controls don't cover it, or 0 when its panel isn't in that corner.
 * While it is, the controls are repainted to match `surface`.
 */
export function useWindowControlsInset( surface: 'content' | 'toolbar' ): number {
	const inCorner = useContext( WindowControlsCornerContext );
	const windowControls = useWindowControlsOverlay();
	const inset = inCorner && windowControls ? windowControls.controlsWidth : 0;
	useWindowControlsSurface( inset > 0 ? surface : null );
	return inset;
}
