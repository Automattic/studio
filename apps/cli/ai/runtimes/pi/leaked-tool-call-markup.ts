import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, AssistantMessageEventStream } from '@earendil-works/pi-ai';

/**
 * DeepSeek writes tool calls in its own DSML markup (`<｜DSML｜invoke …>`,
 * with fullwidth bars). The upstream that serves it normally turns that markup
 * into structured tool calls, but sometimes some of it comes back as reply
 * text instead. The tool doesn't run, and because the reply has text and no
 * tool call, the turn ends as if the model were done.
 */
const DSML_TAG = /<\/?[｜|]DSML[｜|][^>]*>/g;

const repliesWithLeakedToolCalls = new WeakSet< AssistantMessage >();

/** Removes the span from the first DSML tag to the end of the last one. */
export function stripLeakedToolCallMarkup( text: string ): string {
	const tags = [ ...text.matchAll( DSML_TAG ) ];
	if ( tags.length === 0 ) {
		return text;
	}
	const first = tags[ 0 ];
	const last = tags[ tags.length - 1 ];
	const start = first.index ?? 0;
	const end = ( last.index ?? 0 ) + last[ 0 ].length;
	return ( text.slice( 0, start ) + text.slice( end ) ).trim();
}

function cleanReply( message: AssistantMessage ): void {
	let leaked = false;
	const content: AssistantMessage[ 'content' ] = [];
	for ( const block of message.content ) {
		if ( block.type !== 'text' ) {
			content.push( block );
			continue;
		}
		const text = stripLeakedToolCallMarkup( block.text );
		if ( text === block.text ) {
			content.push( block );
			continue;
		}
		leaked = true;
		if ( text ) {
			content.push( { ...block, text } );
		}
	}
	if ( ! leaked ) {
		return;
	}
	message.content = content;
	if ( ! content.some( ( block ) => block.type === 'toolCall' ) ) {
		repliesWithLeakedToolCalls.add( message );
	}
}

/**
 * Strips leaked tool-call markup from the final reply, so it never reaches the
 * transcript, the saved session or the next request. A reply that lost a tool
 * call this way is remembered for `endedWithLeakedToolCall`.
 */
export function withLeakedToolCallMarkupRemoved(
	source: AssistantMessageEventStream
): AssistantMessageEventStream {
	const cleaned = createAssistantMessageEventStream();
	void ( async () => {
		for await ( const event of source ) {
			if ( event.type === 'done' ) {
				cleanReply( event.message );
			}
			cleaned.push( event );
		}
		cleaned.end();
	} )();
	return cleaned;
}

/** A reply that ended the turn because its only tool call leaked into the text. */
export function endedWithLeakedToolCall( message: AssistantMessage | undefined ): boolean {
	return Boolean( message && repliesWithLeakedToolCalls.has( message ) );
}
