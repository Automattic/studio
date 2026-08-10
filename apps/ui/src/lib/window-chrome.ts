// Dark window chrome behind the sidebar, the content frame, and the
// window-controls band, mimicking the legacy renderer's `bg-chrome`
// (rgba(30,30,30,1)) and the wp-admin dark chrome. Dark mode goes a step
// deeper so the chrome still contrasts with #1e1e1e content surfaces.
const CHROME_BG_LIGHT = '#1e1e1e';
const CHROME_BG_DARK = '#161616';

export function chromeBackground( colorScheme: 'light' | 'dark' ) {
	return colorScheme === 'dark' ? CHROME_BG_DARK : CHROME_BG_LIGHT;
}

/**
 * Colours for the native window-controls overlay on Windows/Linux, matched to
 * whichever surface the buttons are sitting on: the window chrome around the
 * content frame, or a full-window page covering it (settings, site creation).
 * The two are opposite in light mode, hence the switch.
 */
export function windowControlsColors(
	surface: 'chrome' | 'content',
	colorScheme: 'light' | 'dark'
) {
	if ( surface === 'chrome' ) {
		return { color: chromeBackground( colorScheme ), symbolColor: '#e0e0e0' };
	}
	// Tracks --wpds-color-bg-surface-neutral.
	return colorScheme === 'dark'
		? { color: '#1e1e1e', symbolColor: '#e0e0e0' }
		: { color: '#fcfcfc', symbolColor: '#1e1e1e' };
}
