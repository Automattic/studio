import { ThemeProvider } from '@wordpress/theme';
import { createContext, useContext } from 'react';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { hexToOklch, oklchToHex } from '@/lib/oklch';
import type { PropsWithChildren } from 'react';

// The rebuild's content surfaces. Naming the seed explicitly rather than leaving
// `color` unset is what lets a nested scope reset back to the app theme: an
// unset seed inherits from the enclosing provider.
const APP_BG_LIGHT = '#fafafa';
const APP_BG_DARK = '#141414';
// The theme's own primary, whose hue tints the surfaces when no accent is set.
const DEFAULT_TINT_HUE = 260;

/**
 * The theme seeds for the user's appearance: the accent as the primary seed,
 * and a background in the accent's hue, as strong as the tint intensity.
 */
export function useAppThemeColor() {
	const colorScheme = useColorScheme();
	const { data: preferences } = useUserPreferences();
	const accentColor = preferences?.accentColor ?? undefined;
	const intensity = preferences?.tintIntensity ?? 0;
	const base = hexToOklch( colorScheme === 'dark' ? APP_BG_DARK : APP_BG_LIGHT );
	const accent = accentColor ? hexToOklch( accentColor ) : undefined;
	const chroma = intensity * 0.00025 * ( accent ? Math.min( 1, accent.c / 0.1 ) : 1 );
	return {
		primary: accentColor,
		background: intensity
			? oklchToHex( {
					l: colorScheme === 'dark' ? base.l : base.l - intensity * 0.00025,
					c: chroma,
					h: accent?.h ?? DEFAULT_TINT_HUE,
			  } )
			: colorScheme === 'dark'
			? APP_BG_DARK
			: APP_BG_LIGHT,
	};
}

// The app theme's seeds, set once at the root for the scopes below.
export const AppThemeColorContext = createContext< { primary?: string; background: string } >( {
	background: APP_BG_LIGHT,
} );

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
	return <ThemeProvider color={ useContext( AppThemeColorContext ) }>{ children }</ThemeProvider>;
}
