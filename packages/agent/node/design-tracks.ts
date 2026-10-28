import { studioHost } from '@studio/agent/node/host';
import type {
	TracksAiIdentity,
	TracksEventName,
	TracksProps,
} from '@studio/common/lib/record-tracks-event';

// Who the design events belong to: a Studio Code chat session, or an agent app's
// `studio mcp` connection.
export type DesignTracksContext = TracksAiIdentity;

// Awaited so a turn that exits right after the answer does not drop the event;
// errors are swallowed so a lost event never fails the tool call.
export async function recordDesignTracksEvent(
	event: TracksEventName,
	context: DesignTracksContext | undefined,
	props: TracksProps
): Promise< void > {
	if ( ! context ) return;
	try {
		await studioHost().tracks.record( event, { ...context, ...props } );
	} catch {
		// A lost analytics event must never break the design flow.
	}
}
