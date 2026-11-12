import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import { withErrorRewrite } from './runtime-guards/error-rewrite';
import { withLeakedToolCallMarkupRemoved } from './runtime-guards/leaked-tool-call-markup';
import { stripStaleImagesFromContext } from './runtime-guards/strip-stale-images';
import type { Api, Model, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import type { AiConnection } from '@studio/providers';

// pi's stock stream for the connection's API, with the connection's error
// rewrite, the leaked tool-call cleanup, and stale screenshots stripped, which
// would otherwise bloat requests past the provider's body limit.
export function createConnectionStream( { requestModelId, rewriteError }: AiConnection ) {
	return ( model: Model< Api >, context: TranscriptContext, options?: SimpleStreamOptions ) => {
		// Each API's stream function is narrower than `Model< Api >`; the model is
		// the one its API's function expects.
		const stream = (
			model.api === 'openai-completions'
				? streamOpenAiCompletions
				: model.api === 'anthropic-messages'
				? streamAnthropicMessages
				: streamOpenAiResponses
		) as typeof streamOpenAiCompletions;
		// The model keeps its stable id for pi and the session history; only the
		// request names the provider's upstream alias.
		return withErrorRewrite(
			withLeakedToolCallMarkupRemoved(
				stream( model as Model< 'openai-completions' >, stripStaleImagesFromContext( context ), {
					...options,
					...( requestModelId
						? {
								onPayload: async ( params: unknown, payloadModel: Model< Api > ) => {
									const next = ( await options?.onPayload?.( params, payloadModel ) ) ?? params;
									return { ...( next as Record< string, unknown > ), model: requestModelId };
								},
						  }
						: {} ),
				} )
			),
			rewriteError
		);
	};
}
