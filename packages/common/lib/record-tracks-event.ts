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
} as const;

export type TracksEventName = ( typeof TRACKS_EVENTS )[ keyof typeof TRACKS_EVENTS ];

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

// Builds the Tracks pixel URL. Isolated so a param-name correction is a one-file change.
// `_en` event name, `_ut`/`_ui` identity, `_ts` timestamp (ms), `_via` origin tag. Every prop is
// coerced to a string (Tracks stores all values as strings). `undefined` props are dropped.
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
// `__bumpStat`. `_via` is expected to be supplied by the caller within `props`.
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
