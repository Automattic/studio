// Dark window chrome behind the sidebar, the content frame, and the
// window-controls band, mimicking the legacy renderer's `bg-chrome`
// (rgba(30,30,30,1)) and the wp-admin dark chrome. Dark mode goes a step
// deeper so the chrome still contrasts with #1e1e1e content surfaces.
const CHROME_BG_LIGHT = '#1e1e1e';
const CHROME_BG_DARK = '#161616';

export function chromeBackground( colorScheme: 'light' | 'dark' ) {
	return colorScheme === 'dark' ? CHROME_BG_DARK : CHROME_BG_LIGHT;
}
