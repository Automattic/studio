/**
 * Preference values shared by every Studio front end. They all read the same
 * `app.json`, so the accepted values and their defaults are stated once here.
 */

export const SUPPORTED_COLOR_SCHEMES = [ 'system', 'light', 'dark' ] as const;
export type ColorScheme = ( typeof SUPPORTED_COLOR_SCHEMES )[ number ];

export const DEFAULT_COLOR_SCHEME: ColorScheme = 'system';

export const QUIT_SITES_BEHAVIORS = [ 'stop', 'stop-and-auto-start', 'leave-running' ] as const;
export type QuitSitesBehavior = ( typeof QUIT_SITES_BEHAVIORS )[ number ];

// What Add site opens on: the starting points, or straight on a blank site's setup.
export const NEW_SITE_BEHAVIORS = [ 'choose', 'blank' ] as const;
export type NewSiteBehavior = ( typeof NEW_SITE_BEHAVIORS )[ number ];

export const DEFAULT_ACCENT_COLOR = '#3858e9';
export const DEFAULT_TINT_INTENSITY = 0;
export const DEFAULT_CONTRAST = 0;

export interface ColorTint {
	// A `#rrggbb` hex color.
	accentColor: string;
	// Percentages, 0–100.
	tintIntensity: number;
	contrast: number;
}

export function getColorTint( config: {
	accentColor?: unknown;
	tintIntensity?: unknown;
	contrast?: unknown;
} ): ColorTint {
	const percent = ( value: unknown, fallback: number ) =>
		typeof value === 'number' && value >= 0 && value <= 100 ? value : fallback;
	return {
		accentColor:
			typeof config.accentColor === 'string' && /^#[0-9a-f]{6}$/i.test( config.accentColor )
				? config.accentColor.toLowerCase()
				: DEFAULT_ACCENT_COLOR,
		tintIntensity: percent( config.tintIntensity, DEFAULT_TINT_INTENSITY ),
		contrast: percent( config.contrast, DEFAULT_CONTRAST ),
	};
}

/**
 * The interface preferences and their defaults: what Settings ▸ Reset interface
 * restores. `null` is a preference left unset ("Ask every time" on quit).
 */
export const INTERFACE_PREFERENCE_DEFAULTS = {
	colorScheme: DEFAULT_COLOR_SCHEME,
	quitSitesBehavior: null,
	autoStartSiteOnChat: false,
	confirmDeleteAnnotations: true,
	showRecentChats: true,
	autoCollapseSites: true,
	newSiteBehavior: 'choose',
	accentColor: DEFAULT_ACCENT_COLOR,
	tintIntensity: DEFAULT_TINT_INTENSITY,
	contrast: DEFAULT_CONTRAST,
} as const;
