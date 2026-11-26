import { isContextOverflow } from '@earendil-works/pi-ai';
import { __, sprintf } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { getRefusedKeyMessage } from './account';
import { toConfigModels, type LocalLlmConfig } from './config';
import { getServerAddress, LOCAL_LLM_MODEL_PREFIX } from './descriptor';
import { fetchChatModels, fetchModelEntries, readModelFacts, RefusedKeyError } from './server';
import type { AiConnection, CatalogModel, ProviderServices } from '../types';
import type { AssistantMessage } from '@earendil-works/pi-ai';

// Compaction plans for a window this size when the server doesn't say what it runs the model
// with. A server that runs it with less refuses what doesn't fit, and pi compacts and retries.
const UNKNOWN_CONTEXT_WINDOW = 128_000;

// pi sends a request only with a key; a server that takes none ignores it.
const NO_KEY = 'none';

const notConnected = () =>
	new NotConnectedError( 'Connect Local LLM with the address of your model server.' );

const getNotAnsweringMessage = ( address: string ) =>
	sprintf(
		/* translators: %s: the address of the user's model server, such as http://localhost:11434 */
		__( 'The local server at %s isn’t answering. Start it, then send your message again.' ),
		address
	);

// The innermost message of an error body, which servers nest as JSON inside JSON.
function readReason( body: string ): string {
	try {
		const parsed = JSON.parse( body ) as { message?: unknown; error?: unknown };
		const inner =
			typeof parsed.error === 'object' && parsed.error !== null
				? ( parsed.error as { message?: unknown } ).message
				: parsed.message ?? parsed.error;
		return typeof inner === 'string' ? readReason( inner ) : body;
	} catch {
		return body;
	}
}

/**
 * Says what went wrong in a turn, in the connector's words: a server that doesn't answer, a
 * refused key, and a request the server refuses, with the server's reason. Leaves context
 * overflows, rate limits and server errors as they are, so pi compacts or retries them.
 */
function rewriteError( message: string, address: string ): string | undefined {
	const [ , status, body = '' ] = /^(\d{3})\b:?\s*([\s\S]*)$/.exec( message.trim() ) ?? [];
	if ( ! status ) {
		return /connection error|fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|other side closed|timed out|terminated/i.test(
			message
		)
			? getNotAnsweringMessage( address )
			: undefined;
	}
	if ( status === '401' || status === '403' ) {
		return getRefusedKeyMessage();
	}
	const overflow = isContextOverflow( {
		stopReason: 'error',
		errorMessage: message,
	} as AssistantMessage );
	if ( ! status.startsWith( '4' ) || status === '429' || overflow ) {
		return undefined;
	}
	return sprintf(
		/* translators: %s: why the server refused the request, in the server's words */
		__( 'Your local server refused the request: %s.' ),
		readReason( body ).replace( /\.$/, '' ) || status
	);
}

export const localLlmAi: NonNullable< ProviderServices< LocalLlmConfig >[ 'ai' ] > = {
	async model( config, modelId, { thinking } ): Promise< AiConnection > {
		if ( ! config ) {
			throw notConnected();
		}
		if ( ! modelId.startsWith( LOCAL_LLM_MODEL_PREFIX ) ) {
			throw new Error( `Local LLM does not serve ${ modelId }` );
		}
		const name = modelId.slice( LOCAL_LLM_MODEL_PREFIX.length );
		const { baseUrl, apiKey } = config;
		const address = getServerAddress( baseUrl );
		// A server that doesn't answer leaves the facts unsaid; the turn's request then fails with
		// the words for it.
		const entries = await fetchModelEntries( baseUrl, apiKey ).catch( () => undefined );
		const entry = entries?.find( ( { id } ) => id === name ) ?? { id: name };
		const [ facts ] = entries
			? await readModelFacts( baseUrl, apiKey, [ entry ], { context: true } )
			: [ {} ];
		return {
			piProvider: 'local-llm',
			apiKey: apiKey ?? NO_KEY,
			requestModelId: name,
			rewriteError: ( message ) => rewriteError( message, address ),
			...( facts.context
				? {
						exactContextWindow: {
							overflowMessage: sprintf(
								/* translators: %s: a model's name */
								__(
									'The context %s runs with is too small for Studio Code. Raise its context length in your server’s settings.'
								),
								name
							),
						},
				  }
				: {} ),
			model: {
				id: modelId,
				name,
				api: 'openai-completions',
				provider: 'local-llm',
				baseUrl,
				reasoning: true,
				input: facts.images ? [ 'text', 'image' ] : [ 'text' ],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: facts.context ?? UNKNOWN_CONTEXT_WINDOW,
				maxTokens: 32_000,
				// The plain Chat Completions shape every server accepts: pi infers OpenAI's from the
				// base URL, which adds fields only OpenAI takes. `reasoning_effort` goes only with a
				// level the chat picked, so the server's default holds otherwise; "none" turns
				// thinking off on vLLM and Ollama.
				...( thinking ? { thinkingLevelMap: { off: 'none' } } : {} ),
				compat: {
					supportsStore: false,
					supportsDeveloperRole: false,
					supportsReasoningEffort: Boolean( thinking ),
					supportsStrictMode: false,
					maxTokensField: 'max_tokens',
				},
			},
		};
	},

	async listModels( config ) {
		if ( ! config ) {
			throw notConnected();
		}
		const { baseUrl, apiKey } = config;
		const models = await fetchChatModels( baseUrl, apiKey ).catch( ( error ) => {
			throw new Error(
				error instanceof RefusedKeyError
					? getRefusedKeyMessage()
					: getNotAnsweringMessage( getServerAddress( baseUrl ) )
			);
		} );
		return models.map(
			( { id, facts } ): CatalogModel => ( {
				id: `${ LOCAL_LLM_MODEL_PREFIX }${ id }`,
				label: id,
				supportsImages: facts.images === true,
				contextWindow: facts.context,
				recommended: facts.tools,
			} )
		);
	},

	selectModels( config, picked ) {
		const models = toConfigModels(
			picked.flatMap( ( model ) =>
				model.id.startsWith( LOCAL_LLM_MODEL_PREFIX )
					? [
							{
								name: model.id.slice( LOCAL_LLM_MODEL_PREFIX.length ),
								images: model.supportsImages,
								tools: model.recommended,
							},
					  ]
					: []
			)
		);
		if ( ! models.length ) {
			throw new Error( __( 'Pick at least one model your server offers.' ) );
		}
		return { ...config, models };
	},
};
