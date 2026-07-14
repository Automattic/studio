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

export {
	TRACKS_EVENTS,
	type TracksEventName,
	type TracksChannel,
	type TracksUiVersion,
} from '@studio/common/lib/record-tracks-event';

async function commonProps(): Promise< TracksProps > {
	return {
		platform: process.platform,
		arch: process.arch,
		app_version: app.getVersion(),
		is_a11n: await isAutomatticianFromToken(),
	};
}

// The desktop single entry point for Tracks. Enforces the gates here — the only place they're checked
// in the desktop. Runs in parallel with MC Stats; neither gates the other.
export async function recordTracksEvent(
	event: TracksEventName,
	props: TracksProps = {}
): Promise< void > {
	// Never emit from dev/CI builds. Set by the dev tooling and CI (see the e2e pipeline), same signal
	// that gates Sentry init. This keeps CI app launches (e.g. the unsigned `electron-forge package`
	// build used by e2e, which reports version `1.0.0`) out of the real Tracks data — the shared core's
	// E2E/NODE_ENV guard only covers launch paths that happen to set those, whereas IS_DEV_BUILD is
	// present on every CI build.
	if ( process.env.IS_DEV_BUILD ) {
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
