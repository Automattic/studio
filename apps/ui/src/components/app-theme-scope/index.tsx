import { ThemeProvider } from '@wordpress/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PropsWithChildren } from 'react';

// `#fcfcfc` is the design system's own light seed. Naming it explicitly rather
// than leaving `color` unset is what lets a nested scope reset back to the app
// theme: an unset seed inherits from the enclosing provider.
const APP_BG_LIGHT = '#fcfcfc';
const APP_BG_DARK = '#1e1e1e';

export function appThemeColor( colorScheme: 'light' | 'dark' ) {
	return { background: colorScheme === 'dark' ? APP_BG_DARK : APP_BG_LIGHT };
}

/**
 * Re-establishes the app's own theme for overlays that portal out of the DOM.
 *
 * wpds overlays wrap their portalled content in a bare `ThemeProvider`, which
 * resolves its palette from React context rather than the DOM. An overlay
 * rendered from inside the sidebar's dark chrome scope therefore paints itself
 * dark even in light mode — this puts it back on the app theme. The wrapper
 * itself is `display: contents`, so it never affects layout.
 */
export function AppThemeScope( { children }: PropsWithChildren ) {
	const colorScheme = useColorScheme();
	return <ThemeProvider color={ appThemeColor( colorScheme ) }>{ children }</ThemeProvider>;
}
