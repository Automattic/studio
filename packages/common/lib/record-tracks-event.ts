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
	SITE_IMPORT: 'studio_site_imported',
	SITE_EXPORT: 'studio_site_exported',
	PREVIEW_SITE_CREATE: 'studio_preview_site_create',
	PREVIEW_SITE_UPDATE: 'studio_preview_site_update',
	PREVIEW_SITE_DELETE: 'studio_preview_site_delete',
	PREVIEW_SITE_DELETE_ALL: 'studio_preview_site_delete_all',
	PREVIEW_SITE_OPEN: 'studio_preview_site_open',
	PANEL_OPENED: 'studio_panel_opened',
	SETTING_TELEMETRY_CHANGE: 'studio_setting_telemetry_change',
	SETTING_APPEARANCE_CHANGE: 'studio_setting_appearance_change',
	SETTING_DATABASE_APPEARANCE_CHANGE: 'studio_setting_database_appearance_change',
	SETTING_LANGUAGE_CHANGE: 'studio_setting_language_change',
	SETTING_CODE_EDITOR_CHANGE: 'studio_setting_code_editor_change',
	SETTING_TERMINAL_CHANGE: 'studio_setting_terminal_change',
	SETTING_DEFAULT_DIRECTORY_CHANGE: 'studio_setting_default_directory_change',
	SETTING_QUIT_ACTION_CHANGE: 'studio_setting_quit_action_change',
	SETTING_CLI_CHANGE: 'studio_setting_cli_change',
	SETTING_AGENTIC_FEATURES_CHANGE: 'studio_setting_agentic_features_change',
	SETTING_UI_CHANGE: 'studio_setting_ui_change',
	SETTING_INSTRUCTIONS_CHANGE: 'studio_setting_instructions_change',
	SETTING_AI_PROVIDER_CHANGE: 'studio_setting_ai_provider_change',
	CODE_MESSAGE_SENT: 'studio_code_message_sent',
	CODE_TURN_COMPLETED: 'studio_code_turn_completed',
	CODE_SESSION_CREATED: 'studio_code_session_created',
	ONBOARDING_COMPLETE: 'studio_onboarding_complete',
	WPCOM_AUTH: 'studio_wpcom_auth',
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

// Which application an event came from: the Electron app, the browser UI served by `studio ui`, or a
// bare terminal invocation. Orthogonal to `ui_version`, which is the renderer chrome.
// See `docs/design-docs/analytics-tracks.md`.
export const TRACKS_CHANNELS = [ 'studio-ui', 'studio-cli', 'studio-web' ] as const;
export type TracksChannel = ( typeof TRACKS_CHANNELS )[ number ];
export type TracksUiVersion = 'v1' | 'v2';

export function isTracksChannel( value: unknown ): value is TracksChannel {
	return TRACKS_CHANNELS.includes( value as TracksChannel );
}

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

// Studio Code event vocabulary, using the data team's shared AI-event property names.
export interface TracksAiIdentity {
	ai_session_id: string;
	agent_name: string;
	client: TracksAiClient;
}

// Which AI product the event came from; `channel` still records the surface.
export type TracksAiClient = 'studio-code';

// Sent as `length_bucket`; bucketed because the instructions text is never sent.
export type TracksInstructionsLengthBucket = 'empty' | 'short' | 'medium' | 'long';

export function getInstructionsLengthBucket( content: string ): TracksInstructionsLengthBucket {
	const length = content.trim().length;
	if ( length === 0 ) {
		return 'empty';
	}
	if ( length <= 200 ) {
		return 'short';
	}
	return length <= 1000 ? 'medium' : 'long';
}

// The site panel/tab a `studio_panel_opened` event refers to. Studio Classic emits the tab-strip names
// (`sync`/`import-export`/`previews` are Classic-only); the agentic UI reuses the shared names —
// `settings` for its General tab and `debugging` for its Debugging tab.
export type TracksPanel =
	| 'overview'
	| 'settings'
	| 'debugging'
	| 'assistant'
	| 'sync'
	| 'import-export'
	| 'previews';

// Where a WordPress.com login was started from, sent as `source` on `studio_wpcom_auth`. The value is
// captured at initiation (the renderer affordance the user clicked) and carried to the deep-link result;
// `unknown` covers the cases where that link is broken — an app restart mid-flow, a cold-start deep link,
// or a context that outlived its TTL. `cli` is the standalone `studio auth login` flow.
export type TracksAuthSource =
	| 'onboarding'
	| 'sync_tab'
	| 'previews_tab'
	| 'assistant_tab'
	| 'overview_tab'
	| 'settings'
	| 'top_bar'
	| 'site_header'
	| 'add_site'
	| 'cli'
	| 'unknown';

// Whether the user signed up or logged in with an existing account. Known only at initiation (the
// desktop opens a different URL for each); absent on CLI events, which have no signup path.
export type TracksAuthAccountType = 'new' | 'existing';

// Coarse, low-cardinality auth failure classification. The raw error is never sent — it can embed the
// OAuth URL and the user's email. `access_denied` is the user declining on WordPress.com; the other two
// are the token-exchange and profile-fetch steps failing.
export type TracksAuthFailureReason =
	| 'access_denied'
	| 'token_error'
	| 'profile_fetch_failed'
	| 'unknown';

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

function omitUndefined( props: TracksProps ): TracksProps {
	return Object.fromEntries(
		Object.entries( props ).filter( ( [ , value ] ) => value !== undefined )
	);
}

// Returns true if we attempted to record the event. Fire-and-forget, no-ops in E2E/dev like
// `__bumpStat`. The timeout prevents an unreachable endpoint from keeping short-lived CLI processes
// alive after their command has completed.
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
		// Log what would actually be sent: the builder drops `undefined` props, so printing the raw
		// object would show optional props as `undefined` and imply they were part of the request.
		console.info( `Would have recorded Tracks event: ${ eventName }`, omitUndefined( props ) );
		return false;
	}

	// Fire and forget GET request (pixel).
	fetch( url, { method: 'GET', signal: AbortSignal.timeout( 5_000 ) } ).catch( () => {
		// A failed request typically indicates a network issue, which we don't need to report
	} );

	return true;
}
