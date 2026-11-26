import { app } from 'electron';
import { isAutomatticianFromToken } from '@studio/common/lib/auth-token';
import { getOrCreateAnalyticsInstallId, isAnalyticsOptedOut } from '@studio/common/lib/install';
import {
	__recordTracksEvent,
	type TracksEventName,
	type TracksProps,
} from '@studio/common/lib/record-tracks-event';

export {
	TRACKS_EVENTS,
	type TracksEventName,
	type TracksChannel,
	type TracksUiVersion,
	type TracksSiteCreateFlowType,
	type TracksAuthSource,
	type TracksAuthFailureReason,
} from '@studio/common/lib/record-tracks-event';

async function commonProps(): Promise< TracksProps > {
	return {
		platform: process.platform,
		arch: process.arch,
		app_version: app.getVersion(),
		is_a11n: await isAutomatticianFromToken(),
		channel: 'studio-ui',
		ui_version: 'v2',
	};
}

// The desktop single entry point for Tracks. Enforces the gates here — the only place they're checked
// in the desktop. Runs in parallel with MC Stats; neither gates the other.
export async function recordTracksEvent(
	event: TracksEventName,
	props: TracksProps = {}
): Promise< void > {
	// Never emit from dev builds or an unpackaged app. `IS_DEV_BUILD` (also gates Sentry init) covers a
	// developer's local dev build. Every build people install, nightly and dev builds included, is
	// packaged; an unpackaged app is `npm start` or a unit test booting the app with a mocked
	// version. The shared core also refuses test, CI and E2E runs.
	if ( process.env.IS_DEV_BUILD || ! app.isPackaged ) {
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
