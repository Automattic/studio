import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import { windowControlsColors } from '@/lib/window-chrome';

/**
 * Repaints the Windows/Linux window-controls overlay for as long as the caller
 * is mounted, restoring the window chrome's colours when it unmounts.
 *
 * The dashboard leaves the buttons on the chrome gap above the content frame,
 * but a full-window page (settings, site creation) covers that chrome with a
 * surface that is the opposite shade in light mode. Only the covering surface
 * knows it is showing, so it owns the switch — and the restore on unmount is
 * what puts the chrome colours back.
 */
export function useWindowControlsSurface( surface: 'chrome' | 'content' ) {
	const connector = useConnector();
	const colorScheme = useColorScheme();
	const hasOverlay = useWindowControlsOverlay() !== null;

	useEffect( () => {
		if ( ! hasOverlay || ! connector.setWindowControlsColors ) {
			return;
		}
		void connector.setWindowControlsColors( windowControlsColors( surface, colorScheme ) );
		return () => {
			void connector.setWindowControlsColors?.( windowControlsColors( 'chrome', colorScheme ) );
		};
	}, [ connector, surface, colorScheme, hasOverlay ] );
}
