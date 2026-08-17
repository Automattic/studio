import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';

/**
 * Tells the host which surface the Windows/Linux window controls are sitting on
 * for as long as the caller is mounted, restoring the window chrome when it
 * unmounts.
 *
 * The dashboard leaves the buttons on the chrome gap above the content frame,
 * but a full-window page (settings, site creation) covers that chrome with a
 * surface that is the opposite shade in light mode. Only the covering surface
 * knows it is showing, so it owns the switch — and the restore on unmount is
 * what puts the chrome back. The host owns the actual colours.
 */
export function useWindowControlsSurface( surface: 'chrome' | 'content' ) {
	const connector = useConnector();
	const hasOverlay = useWindowControlsOverlay() !== null;

	useEffect( () => {
		if ( ! hasOverlay || ! connector.setWindowControlsSurface ) {
			return;
		}
		void connector.setWindowControlsSurface( surface );
		return () => {
			void connector.setWindowControlsSurface?.( 'chrome' );
		};
	}, [ connector, surface, hasOverlay ] );
}
