import {
	DEFAULT_ACCENT_COLOR,
	DEFAULT_CONTRAST,
	DEFAULT_TINT_INTENSITY,
	getColorTint,
	type ColorScheme,
	type ColorTint,
} from '@studio/common/lib/user-settings/preferences';
import { applyAccentContrast } from './accent-contrast';
import { hexToOklch } from './color';

const DEFAULT_TINT_HUE = 260;

export const DEFAULT_COLOR_TINT: ColorTint = {
	accentColor: DEFAULT_ACCENT_COLOR,
	tintIntensity: DEFAULT_TINT_INTENSITY,
	contrast: DEFAULT_CONTRAST,
};

export function isDefaultColorTint( tint: ColorTint ): boolean {
	return (
		tint.accentColor === DEFAULT_ACCENT_COLOR &&
		tint.tintIntensity === DEFAULT_TINT_INTENSITY &&
		tint.contrast === DEFAULT_CONTRAST
	);
}

export function resolveColorScheme( saved: ColorScheme = 'system' ): 'light' | 'dark' {
	if ( saved !== 'system' ) {
		return saved;
	}
	return window.matchMedia?.( '(prefers-color-scheme: dark)' ).matches ? 'dark' : 'light';
}

/** Sets the appearance inputs the color tokens in `tokens.css` derive from. */
export function applyColorTint(
	tint: Partial< ColorTint >,
	root: HTMLElement = document.documentElement
): void {
	const { accentColor, tintIntensity, contrast } = getColorTint( tint );
	root.dataset.accentColor = accentColor;
	const custom = accentColor !== DEFAULT_ACCENT_COLOR ? hexToOklch( accentColor ) : undefined;
	root.style.setProperty( '--tint-hue', String( custom?.h ?? DEFAULT_TINT_HUE ) );
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

/** The accent fill a tint would get in the current color scheme. */
export function previewAccentColor( tint: Partial< ColorTint > ): string {
	const preview = document.createElement( 'span' );
	preview.dataset.colorScheme = document.documentElement.dataset.colorScheme ?? 'light';
	preview.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
	document.documentElement.append( preview );
	try {
		applyColorTint( tint, preview );
		return preview.style.getPropertyValue( '--accent-fill' ) || getColorTint( tint ).accentColor;
	} finally {
		preview.remove();
	}
}
