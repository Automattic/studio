// Automattic Tracks event logging. Runs alongside the MC Stats system in `./bump-stat.ts` — see
// `docs/design-docs/analytics-tracks.md`. This module is the low-level, environment-agnostic builder
// and sender: it does NOT read config or opt-out state. Callers must go through the per-app wrappers
// (`apps/studio/src/lib/tracks.ts`, `apps/cli/lib/tracks.ts`), which enforce the opt-out.

const TRACKS_PIXEL_URL = 'https://pixel.wp.com/t.gif';

// Event names. Product-prefixed, snake_case (Tracks convention). Must be registered server-side in
// the Tracks event schema before data is queryable — see the design doc.
export const TRACKS_EVENTS = {
	APP_LAUNCH: 'studio_app_launch',
	SITE_START: 'studio_site_start',
	SITE_CREATE: 'studio_site_created',
	SITE_STOP: 'studio_site_stop',
	SITE_DELETE: 'studio_site_delete',
	SITE_OPEN_IN_BROWSER: 'studio_site_open_in_browser',
	SITE_OPEN_IN_EDITOR: 'studio_site_open_in_editor',
	SITE_OPEN_IN_TERMINAL: 'studio_site_open_in_terminal',
	SITE_OPEN_WP_ADMIN: 'studio_site_open_wp_admin',
	SITE_OPEN_CUSTOMIZE: 'studio_site_open_customize',
	SITE_OPEN_PHPMYADMIN: 'studio_site_open_phpmyadmin',
	SITE_OPEN_FOLDER: 'studio_site_open_folder',
	PREVIEW_SITE_CREATE: 'studio_preview_site_create',
	PREVIEW_SITE_UPDATE: 'studio_preview_site_update',
	PREVIEW_SITE_DELETE: 'studio_preview_site_delete',
	PREVIEW_SITE_DELETE_ALL: 'studio_preview_site_delete_all',
	PREVIEW_SITE_OPEN: 'studio_preview_site_open',
	PANEL_OPENED: 'studio_panel_opened',
	SETTING_TELEMETRY_CHANGE: 'studio_setting_telemetry_change',
	SETTING_APPEARANCE_CHANGE: 'studio_setting_appearance_change',
	SETTING_LANGUAGE_CHANGE: 'studio_setting_language_change',
	SETTING_CODE_EDITOR_CHANGE: 'studio_setting_code_editor_change',
	SETTING_TERMINAL_CHANGE: 'studio_setting_terminal_change',
	SETTING_DEFAULT_DIRECTORY_CHANGE: 'studio_setting_default_directory_change',
	SETTING_QUIT_ACTION_CHANGE: 'studio_setting_quit_action_change',
	SETTING_CLI_CHANGE: 'studio_setting_cli_change',
	SETTING_AGENTIC_FEATURES_CHANGE: 'studio_setting_agentic_features_change',
	SETTING_UI_CHANGE: 'studio_setting_ui_change',
} as const;

export type TracksEventName = ( typeof TRACKS_EVENTS )[ keyof typeof TRACKS_EVENTS ];

const TRACKS_EVENT_NAMES = new Set< string >( Object.values( TRACKS_EVENTS ) );

// Runtime check that a value is a known event name. Use at trust boundaries (e.g. the renderer IPC
// handler) where the compile-time `TracksEventName` type isn't enforced.
export function isTracksEventName( value: unknown ): value is TracksEventName {
	return typeof value === 'string' && TRACKS_EVENT_NAMES.has( value );
}

// Phase 1 is anonymous-only: `_ut=anon` with an anonymous install UUID. No PII is ever attached.
export interface TracksIdentity {
	type: 'anon';
	id: string;
}

export type TracksProps = Record< string, string | number | boolean | undefined >;

// Shared origin vocabulary — which application/renderer an event came from. Kept here so the desktop
// and CLI wrappers stay in sync. See `docs/design-docs/analytics-tracks.md`.
export type TracksChannel = 'studio-ui' | 'studio-cli';
export type TracksUiVersion = 'v1' | 'v2';

// The path a site came into existence through, for `studio_site_created`. `blueprint` is inferred by
// the CLI from the presence of a blueprint; the other non-`new` values are threaded down from the
// caller (import/sync from a renderer, duplicate from the desktop Main `copySite` handler).
export type TracksSiteCreateFlowType = 'new' | 'blueprint' | 'import' | 'sync' | 'duplicate';

// Where a site "open" action rendered the site content, sent as `browser` on the site-content open
// events (open_in_browser/wp_admin/customize/phpmyadmin). Studio Classic (v1) always opens the OS
// browser (`external`); the agentic UI (v2) can open its in-app preview panel (`internal`).
export type TracksBrowserTarget = 'external' | 'internal';

// The affordance a `studio_site_open_customize` event was launched from, sent as `entry_point`. Block
// themes expose the site editor and its sub-views plus the media library; classic themes expose the
// Customizer and (theme-dependent) Menus/Widgets screens.
export type TracksCustomizeEntryPoint =
	| 'editor'
	| 'editor_styles'
	| 'editor_patterns'
	| 'editor_navigation'
	| 'editor_templates'
	| 'editor_pages'
	| 'media_library'
	| 'customizer'
	| 'menus'
	| 'widgets';

// The site panel/tab a `studio_panel_opened` event refers to. Studio Classic emits the tab-strip names
// (`sync`/`import-export`/`previews` are Classic-only); the agentic UI emits its site overview tabs and
// `assistant` when a site conversation opens.
export type TracksPanel =
	| 'overview'
	| 'settings'
	| 'agent'
	| 'checkpoints'
	| 'assistant'
	| 'sync'
	| 'import-export'
	| 'previews';

// Builds the Tracks pixel URL. Isolated so a param-name correction is a one-file change. These are
// the reserved Tracks pixel params: `_en` event name, `_ut`/`_ui` identity, `_ts` timestamp (ms).
// Every event prop is coerced to a string (Tracks stores all values as strings) and appended as its
// own query param; `undefined` props are dropped. Origin/context lives in the `channel` event prop,
// not a reserved param.
export function __buildTracksPixelUrl(
	eventName: TracksEventName,
	identity: TracksIdentity,
	props: TracksProps,
	timestampMs: number = Date.now()
): string {
	const url = new URL( TRACKS_PIXEL_URL );
	const params = url.searchParams;

	params.set( '_en', eventName );
	params.set( '_ut', identity.type );
	params.set( '_ui', identity.id );
	params.set( '_ts', String( timestampMs ) );

	for ( const [ key, value ] of Object.entries( props ) ) {
		if ( value !== undefined ) {
			params.set( key, String( value ) );
		}
	}

	return url.toString();
}

// Returns true if we attempted to record the event. Fire-and-forget, no-ops in E2E/dev like
// `__bumpStat`.
export function __recordTracksEvent(
	eventName: TracksEventName,
	identity: TracksIdentity,
	props: TracksProps
): boolean {
	const url = __buildTracksPixelUrl( eventName, identity, props );

	if ( process.env.STUDIO_DEBUG_TRACKS ) {
		console.info( `Tracks event URL: ${ url }` );
	}

	if ( process.env.E2E || process.env.NODE_ENV === 'development' ) {
		console.info( `Would have recorded Tracks event: ${ eventName }`, props );
		return false;
	}

	// Fire and forget GET request (pixel).
	fetch( url, { method: 'GET' } ).catch( () => {
		// A failed request typically indicates a network issue, which we don't need to report
	} );

	return true;
}
