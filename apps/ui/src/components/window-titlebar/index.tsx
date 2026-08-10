import { useLayoutEffect } from 'react';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWindowControlsOverlay } from '@/hooks/use-window-controls-overlay';
import { chromeBackground } from '@/lib/window-chrome';
import styles from './style.module.css';

/**
 * Windows and Linux paint the native window controls over the renderer at the
 * top of the window, and the overlay API offers no way to offset them. So the
 * app reserves a band of window chrome for them to sit in and publishes its
 * height as `--app-titlebar-height`; every full-window surface (the dashboard,
 * settings, onboarding) starts below it, which keeps the content frame fully
 * inset and rounded instead of having to flatten a corner to meet the buttons.
 *
 * macOS positions its traffic lights via `trafficLightPosition` and reserves
 * nothing here — the height stays 0 and no band renders.
 */
export function WindowTitlebar() {
	const overlay = useWindowControlsOverlay();
	const colorScheme = useColorScheme();
	const height = overlay?.height ?? 0;

	// Layout effect, not a plain one: the surfaces below read the variable to
	// size themselves, so setting it after paint would flash them at full height.
	useLayoutEffect( () => {
		document.documentElement.style.setProperty( '--app-titlebar-height', `${ height }px` );
	}, [ height ] );

	if ( ! height ) {
		return null;
	}
	return (
		<div
			className={ styles.band }
			style={ { backgroundColor: chromeBackground( colorScheme ) } }
			aria-hidden="true"
		/>
	);
}
