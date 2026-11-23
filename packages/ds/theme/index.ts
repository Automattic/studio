import { applyAccentContrast } from './accent-contrast';
import { hexToOklch } from './color';

// The accent and tint hue `tokens.css` is drawn from. Other accents rotate its palette.
const BASE_ACCENT_COLOR = '#3858e9';
const BASE_TINT_HUE = 260;

interface ColorTint {
	// A `#rrggbb` hex color.
	accentColor: string;
	// Percentages, 0–100.
	tintIntensity: number;
	contrast: number;
}

export function resolveColorScheme(
	saved: 'system' | 'light' | 'dark' = 'system'
): 'light' | 'dark' {
	if ( saved !== 'system' ) {
		return saved;
	}
	return window.matchMedia?.( '(prefers-color-scheme: dark)' ).matches ? 'dark' : 'light';
}

/** Sets the appearance inputs the color tokens in `tokens.css` derive from. */
export function applyColorTint(
	{ accentColor = BASE_ACCENT_COLOR, tintIntensity = 0, contrast = 0 }: Partial< ColorTint >,
	root: HTMLElement = document.documentElement
): void {
	root.dataset.accentColor = accentColor;
	const custom = accentColor !== BASE_ACCENT_COLOR ? hexToOklch( accentColor ) : undefined;
	root.style.setProperty( '--tint-hue', String( custom?.h ?? BASE_TINT_HUE ) );
	root.style.setProperty(
		'--accent-palette-hue-shift',
		String( custom ? custom.h - 268.048352 : 0 )
	);
	root.style.setProperty(
		'--accent-palette-chroma-scale',
		String( custom ? Math.min( 1, custom.c / 0.22 ) : 1 )
	);
	root.style.setProperty(
		'--tint-saturation',
		String( custom ? Math.min( 1, custom.c / 0.1 ) : 1 )
	);
	for ( const [ token, value ] of [
		[ '--accent-hue', custom?.h ],
		[ '--accent-chroma', custom?.c ],
		[ '--accent-lightness', custom?.l ],
	] as const ) {
		if ( value === undefined ) {
			root.style.removeProperty( token );
		} else {
			root.style.setProperty( token, String( value ) );
		}
	}
	root.style.setProperty( '--tint-intensity', String( tintIntensity ) );
	root.style.setProperty( '--contrast', String( contrast ) );
	applyAccentContrast( root );
}

export function applyTheme( colorScheme: 'light' | 'dark', tint: Partial< ColorTint > ): void {
	const root = document.documentElement;
	root.style.colorScheme = colorScheme;
	root.dataset.colorScheme = colorScheme;
	applyColorTint( tint, root );
}

export { getMotionDuration } from './motion';
export { getEmbeddedFontData } from './embedded-font';
