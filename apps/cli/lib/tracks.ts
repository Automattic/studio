import {
	__recordTracksEvent,
	isTracksChannel,
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

// Resolves the origin from `STUDIO_TRACKS_ORIGIN`, a `<channel>:<ui_version>` string set by the host
// that spawned the CLI (e.g. `studio-ui:v2`, `studio-web:v2`). Absent or unrecognized means a
// standalone invocation. See `docs/design-docs/analytics-tracks.md`.
export function getTracksOrigin(): TracksOrigin {
	const [ channel, version ] = ( process.env.STUDIO_TRACKS_ORIGIN ?? '' ).split( ':' );
	if ( ! isTracksChannel( channel ) || channel === 'studio-cli' ) {
		return { channel: 'studio-cli' };
	}
	return { channel, ui_version: version === 'v2' ? 'v2' : 'v1' };
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
// Consequence for local runs: a dev build has the build-time flag off, so telemetry is enabled here
// only via one of the two runtime escape hatches below. In both cases the shared core still no-ops the
// network send in dev/E2E, so nothing is actually sent — they only enable the code path + the "Would
// have recorded…" log:
//   - `NODE_ENV === 'development'` — inherited from the desktop during `npm start`, so CLI events log
//     the same "Would have recorded… studio_site_start" line the desktop already logs for
//     `studio_app_launch`, giving both surfaces the same `npm start` visibility with no extra setup.
//   - `STUDIO_FORCE_CLI_TELEMETRY=1` — exercise Tracks against a dev build outside a dev run (e.g. a
//     standalone CLI invocation), typically paired with `STUDIO_DEBUG_TRACKS=1` to log the pixel URL.
export async function recordTracksEvent(
	event: TracksEventName,
	props: TracksProps = {}
): Promise< void > {
	const telemetryAllowed =
		__ENABLE_CLI_TELEMETRY__ ||
		process.env.STUDIO_FORCE_CLI_TELEMETRY ||
		process.env.NODE_ENV === 'development';
	if ( ! telemetryAllowed ) {
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
