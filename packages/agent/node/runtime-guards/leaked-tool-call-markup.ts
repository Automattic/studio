import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, AssistantMessageEventStream } from '@earendil-works/pi-ai';

/**
 * DeepSeek writes tool calls in its own DSML markup (`<｜DSML｜invoke …>`,
 * with fullwidth bars). The upstream that serves it normally turns that markup
 * into structured tool calls, but sometimes some of it comes back as reply
 * text instead, and the tool never runs. Matches from the first tag to the
 * last one.
 */
const LEAKED_TOOL_CALL = /<\/?[｜|]DSML[｜|](?:[\s\S]*<\/?[｜|]DSML[｜|])?[^>]*>/;

// Without a tool call left, the text that carried the leaked one goes too: the
// reply is then an empty stop, which the runtime continues. The upstream may
// still report the reply as a tool call.
function removeLeakedToolCall( message: AssistantMessage ): void {
	const hasToolCall = message.content.some( ( block ) => block.type === 'toolCall' );
	if ( ! hasToolCall && message.stopReason === 'toolUse' ) {
		message.stopReason = 'stop';
	}
	message.content = message.content.flatMap( ( block ) => {
		if ( block.type !== 'text' || ! LEAKED_TOOL_CALL.test( block.text ) ) {
			return [ block ];
		}
		const text = block.text.replace( LEAKED_TOOL_CALL, '' ).trim();
		return hasToolCall && text ? [ { ...block, text } ] : [];
	} );
}

export function withLeakedToolCallMarkupRemoved(
	source: AssistantMessageEventStream
): AssistantMessageEventStream {
	const cleaned = createAssistantMessageEventStream();
	void ( async () => {
		for await ( const event of source ) {
			if ( event.type === 'done' ) {
				removeLeakedToolCall( event.message );
			}
			cleaned.push( event );
		}
		cleaned.end();
	} )();
	return cleaned;
}
