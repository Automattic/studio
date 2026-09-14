import { getIpcApi } from 'src/lib/get-ipc-api';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';

// Records a Tracks event from the (legacy) renderer. Routes through the `recordAnalyticsEvent` IPC
// handler so the desktop Main wrapper attaches the common props (`channel`, `ui_version`, …) and
// enforces the opt-out in one place. Typed against `TracksEventName` for compile-time name checking;
// fire-and-forget so a telemetry hiccup never affects the UI action that triggered it.
export function recordRendererTracksEvent( event: TracksEventName, props: TracksProps = {} ): void {
	void getIpcApi()
		.recordAnalyticsEvent( event, props )
		.catch( () => {
			// Best-effort telemetry — never surface an error to the UI.
		} );
}
