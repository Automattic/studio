import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AiConnection } from '@studio/providers';

// Applies the connection's `rewriteError` to the stream's error event, before
// pi decides whether to retry it.
export function withErrorRewrite(
	source: AssistantMessageEventStream,
	rewrite: AiConnection[ 'rewriteError' ]
): AssistantMessageEventStream {
	if ( ! rewrite ) {
		return source;
	}
	const rewritten = createAssistantMessageEventStream();
	void ( async () => {
		for await ( const event of source ) {
			if ( event.type === 'error' ) {
				event.error.errorMessage =
					rewrite( event.error.errorMessage ?? '' ) ?? event.error.errorMessage;
			}
			rewritten.push( event );
		}
		rewritten.end();
	} )();
	return rewritten;
}
