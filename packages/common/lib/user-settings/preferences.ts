/**
 * Global preference values shared by every Studio front end. The desktop, the
 * `studio ui` server and the browser UI all read the same `app.json`, so the
 * accepted values — and what an unset preference falls back to — have to be
 * stated once rather than restated per app.
 */

export const SUPPORTED_COLOR_SCHEMES = [ 'system', 'light', 'dark' ] as const;
export type ColorScheme = ( typeof SUPPORTED_COLOR_SCHEMES )[ number ];

// Studio has always opened in light mode unless the user chose otherwise.
export const DEFAULT_COLOR_SCHEME: ColorScheme = 'light';

export const QUIT_SITES_BEHAVIORS = [ 'stop', 'stop-and-auto-start', 'leave-running' ] as const;
export type QuitSitesBehavior = ( typeof QUIT_SITES_BEHAVIORS )[ number ];
