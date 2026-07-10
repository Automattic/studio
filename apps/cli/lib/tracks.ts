import {
	__recordTracksEvent,
	TRACKS_EVENTS,
	type TracksEventName,
	type TracksProps,
} from '@studio/common/lib/record-tracks-event';
import {
	getOrCreateAnalyticsInstallId,
	isAnalyticsOptedOut,
	isAutomatticianFromToken,
} from '@studio/common/lib/shared-config';

export { TRACKS_EVENTS, type TracksEventName };

export type TracksChannel = 'studio-ui' | 'studio-cli';
export type TracksUiVersion = 'v1' | 'v2';

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

// The CLI choke point for Tracks. Gated by the shared opt-out AND the build-time telemetry switch (off
// in dev builds, like MC Stats). Unlike MC-Stats launch bumps, this is NOT suppressed by
// `--avoid-telemetry`: the CLI is the sole emitter of site-start events regardless of who spawned it.
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
		{ ...( await commonProps() ), _via: 'studio-cli', ...props }
	);
}
