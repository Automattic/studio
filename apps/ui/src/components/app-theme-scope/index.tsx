// The rebuild's content surfaces. Naming the seed explicitly rather than leaving
// `color` unset is what lets a nested scope reset back to the app theme: an
// unset seed inherits from the enclosing provider.
const APP_BG_LIGHT = '#fafafa';
const APP_BG_DARK = '#141414';

export function appThemeColor( colorScheme: 'light' | 'dark' ) {
	return { background: colorScheme === 'dark' ? APP_BG_DARK : APP_BG_LIGHT };
}
