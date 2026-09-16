import { getAiTracksIdentity } from '@studio/common/ai/tracks-identity';
import { getTracksOrigin, recordTracksEvent, type TracksEventName } from 'cli/lib/tracks';
import type { TracksProps } from '@studio/common/lib/record-tracks-event';

// Present only when a chat session runs the tools; the MCP server has none.
export interface DesignTracksContext {
	sessionId: string;
}

// Awaited so a turn that exits right after the answer does not drop the event;
// errors are swallowed so a lost event never fails the tool call.
export async function recordDesignTracksEvent(
	event: TracksEventName,
	context: DesignTracksContext | undefined,
	props: TracksProps
): Promise< void > {
	if ( ! context ) return;
	try {
		await recordTracksEvent( event, {
			...getTracksOrigin(),
			...getAiTracksIdentity( context.sessionId ),
			...props,
		} );
	} catch {
		// A lost analytics event must never break the design flow.
	}
}
