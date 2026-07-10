import {
	__recordTracksEvent,
	type TracksChannel,
	type TracksEventName,
	type TracksProps,
	type TracksUiVersion,
} from '@studio/common/lib/record-tracks-event';
import {
	getOrCreateAnalyticsInstallId,
	isAnalyticsOptedOut,
	isAutomatticianFromToken,
} from '@studio/common/lib/shared-config';

export {
	TRACKS_EVENTS,
	type TracksEventName,
	type TracksChannel,
	type TracksUiVersion,
} from '@studio/common/lib/record-tracks-event';

export interface TracksOrigin {
	channel: TracksChannel;
	ui_version?: TracksUiVersion;
}

// Resolves the event origin from `STUDIO_TRACKS_ORIGIN`, set by the desktop app when it spawns the CLI
// (e.g. `studio-ui:v1`, `studio-ui:v2`). Absent for a standalone CLI invocation, which is
// `studio-cli`. See `docs/design-docs/analytics-tracks.md`.
export function getTracksOrigin(): TracksOrigin {
	const raw = process.env.STUDIO_TRACKS_ORIGIN;
	if ( raw?.startsWith( 'studio-ui' ) ) {
		const [ , version ] = raw.split( ':' );
		return {
			channel: 'studio-ui',
			ui_version: version === 'v2' ? 'v2' : 'v1',
		};
	}
	return { channel: 'studio-cli' };
}

async function commonProps(): Promise< TracksProps > {
	return {
		platform: process.platform,
		arch: process.arch,
		app_version: __STUDIO_CLI_VERSION__,
		is_a11n: await isAutomatticianFromToken(),
	};
}

// The CLI choke point for Tracks. Two distinct CLI telemetry mechanisms apply here — don't conflate
// them:
//
//   1. `--avoid-telemetry` (runtime flag): the double-count guard marking an app-spawned CLI run.
//      Tracks deliberately IGNORES it — the CLI is the sole emitter of site-start, so app-initiated
//      starts must still count. (This is the "skip the bump-stats double-count setting" decision.)
//   2. `__ENABLE_CLI_TELEMETRY__` (build-time flag): true only in shipped npm/prod builds, false in
//      dev builds. This gates ALL CLI telemetry — MC Stats and Tracks alike — so developer builds
//      emit nothing. It is unrelated to (1). (The shared Tracks core also no-ops in dev/E2E, so this
//      is partly belt-and-suspenders, but it keeps a non-dev build with the flag off silent too, and
//      matches how the sibling MC-Stats CLI code gates — see `recordSiteRuntimeUsage`.)
//
// Consequence for local runs: in a dev build this returns early, so you will NOT see a "Would have
// recorded studio_site_start" log — that's expected, not a bug.
export async function recordTracksEvent(
	event: TracksEventName,
	props: TracksProps = {}
): Promise< void > {
	if ( ! __ENABLE_CLI_TELEMETRY__ ) {
		return;
	}
	if ( await isAnalyticsOptedOut() ) {
		return;
	}

	const installId = await getOrCreateAnalyticsInstallId();
	__recordTracksEvent(
		event,
		{ type: 'anon', id: installId },
		{ ...( await commonProps() ), ...props }
	);
}
