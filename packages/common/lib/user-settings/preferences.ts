/**
 * Preference values shared by every Studio front end. They all read the same
 * `app.json`, so the accepted values and their defaults are stated once here.
 */

export const SUPPORTED_COLOR_SCHEMES = [ 'system', 'light', 'dark' ] as const;
export type ColorScheme = ( typeof SUPPORTED_COLOR_SCHEMES )[ number ];

export const DEFAULT_COLOR_SCHEME: ColorScheme = 'system';

export const QUIT_SITES_BEHAVIORS = [ 'stop', 'stop-and-auto-start', 'leave-running' ] as const;
export type QuitSitesBehavior = ( typeof QUIT_SITES_BEHAVIORS )[ number ];

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
} as const;
