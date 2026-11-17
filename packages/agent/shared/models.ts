import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import { withErrorRewrite } from './runtime-guards/error-rewrite';
import { withLeakedToolCallMarkupRemoved } from './runtime-guards/leaked-tool-call-markup';
import { stripStaleImagesFromContext } from './runtime-guards/strip-stale-images';
import type {
	Api,
	AssistantMessageEventStream,
	Model,
	SimpleStreamOptions,
	TranscriptContext,
} from '@earendil-works/pi-ai';
import type { AiApi, AiConnection } from '@studio/providers';

// pi's stock stream for each API a provider's connection may name.
const STREAMS = {
	'openai-completions': streamOpenAiCompletions,
	'openai-responses': streamOpenAiResponses,
	'anthropic-messages': streamAnthropicMessages,
	// Loads Google's SDK only when a Gemini model runs.
	'google-generative-ai': googleGenerativeAIApi().streamSimple,
} satisfies Record< AiApi, unknown >;

// A turn on an API Studio doesn't run ends with an error, before any request.
function streamUnsupportedApi( model: Model< Api > ): AssistantMessageEventStream {
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
			errorMessage: `Studio doesn’t run the ${ model.api } API, which ${ model.id } connects over.`,
			timestamp: Date.now(),
		},
	} );
	stream.end();
	return stream;
}

// pi's stock stream for the connection's API, with the connection's error
// rewrite, the leaked tool-call cleanup, and stale screenshots stripped, which
// would otherwise bloat requests past the provider's body limit.
export function createConnectionStream( { requestModelId, rewriteError }: AiConnection ) {
	return ( model: Model< Api >, context: TranscriptContext, options?: SimpleStreamOptions ) => {
		if ( ! Object.prototype.hasOwnProperty.call( STREAMS, model.api ) ) {
			return streamUnsupportedApi( model );
		}
		// Each API's stream function is narrower than `Model< Api >`; the model is
		// the one its API's function expects.
		const stream = STREAMS[ model.api as AiApi ] as typeof streamOpenAiCompletions;
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
