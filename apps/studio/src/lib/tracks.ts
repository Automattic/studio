import { app } from 'electron';
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

// Which application/renderer sent the event. See `docs/design-docs/analytics-tracks.md`.
export type TracksChannel = 'studio-ui' | 'studio-cli';
export type TracksUiVersion = 'v1' | 'v2';

async function commonProps(): Promise< TracksProps > {
	return {
		platform: process.platform,
		arch: process.arch,
		app_version: app.getVersion(),
		is_a11n: await isAutomatticianFromToken(),
	};
}

// The desktop choke point for Tracks. Enforces the opt-out here — the only place it is checked in the
// desktop. Runs in parallel with MC Stats; neither gates the other.
export async function recordTracksEvent(
	event: TracksEventName,
	props: TracksProps = {}
): Promise< void > {
	if ( await isAnalyticsOptedOut() ) {
		return;
	}

	const installId = await getOrCreateAnalyticsInstallId();
	__recordTracksEvent(
		event,
		{ type: 'anon', id: installId },
		{ ...( await commonProps() ), _via: 'studio-desktop', ...props }
	);
}
