import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import {
	clampMaxTokensToContext,
	MIN_ANSWER_TOKENS,
} from '@earendil-works/pi-ai/api/simple-options';
import type {
	Api,
	AssistantMessageEventStream,
	Model,
	TranscriptContext,
} from '@earendil-works/pi-ai';

// pi reads this as a context overflow, so it compacts the conversation and retries once.
const CONTEXT_OVERFLOW_ERROR =
	'context_length_exceeded: the request doesn’t fit the context the server runs the model with';

/**
 * Whether the request leaves room for a reply in the model's window, by pi's token estimate: the
 * room pi leaves for the reply once it keeps its own safety margin.
 */
export function fitsContextWindow( model: Model< Api >, context: TranscriptContext ): boolean {
	return clampMaxTokensToContext( model, context, model.maxTokens ) >= MIN_ANSWER_TOKENS;
}

// A request that fails as a context overflow before anything is sent.
export function contextOverflowStream( model: Model< Api > ): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	stream.push( {
		type: 'error',
		reason: 'error',
		error: {
			role: 'assistant',
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: 'error',
			errorMessage: CONTEXT_OVERFLOW_ERROR,
			timestamp: Date.now(),
		},
	} );
	stream.end();
	return stream;
}
