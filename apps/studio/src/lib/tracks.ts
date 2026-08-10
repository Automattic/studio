import { app } from 'electron';
import {
	__recordTracksEvent,
	type TracksEventName,
	type TracksProps,
} from '@studio/common/lib/record-tracks-event';
import {
	getOrCreateAnalyticsInstallId,
	isAnalyticsOptedOut,
	isAutomatticianFromToken,
} from '@studio/common/lib/shared-config';
import { getPreferredUiVersion } from 'src/lib/studio-ui-mode';

export {
	TRACKS_EVENTS,
	type TracksEventName,
	type TracksChannel,
	type TracksUiVersion,
	type TracksSiteCreateFlowType,
} from '@studio/common/lib/record-tracks-event';

async function commonProps(): Promise< TracksProps > {
	return {
		platform: process.platform,
		arch: process.arch,
		app_version: app.getVersion(),
		is_a11n: await isAutomatticianFromToken(),
		channel: 'studio-ui',
		ui_version: getPreferredUiVersion(),
	};
}

// The desktop single entry point for Tracks. Enforces the gates here — the only place they're checked
// in the desktop. Runs in parallel with MC Stats; neither gates the other.
export async function recordTracksEvent(
	event: TracksEventName,
	props: TracksProps = {}
): Promise< void > {
	// Never emit from dev or CI builds. `IS_DEV_BUILD` (also gates Sentry init) covers a developer's
	// local dev build; `CI` is set by every CI environment and is inherited by the packaged app that
	// the e2e step launches, keeping those runs (which report the placeholder version `1.0.0`) out of
	// real Tracks data. A real shipped app has neither set, so this can't suppress genuine telemetry.
	// The shared core's E2E/NODE_ENV guard only covers launch paths that set those.
	if ( process.env.IS_DEV_BUILD || process.env.CI ) {
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
