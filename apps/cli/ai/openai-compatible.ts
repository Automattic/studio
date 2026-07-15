/**
 * Helpers for talking to a user-configured OpenAI-compatible endpoint (a local
 * model server such as vLLM, Apfel, LM Studio, Ollama, or llama.cpp).
 *
 * The Studio CLI agent runs on the pi runtime, which speaks the OpenAI
 * chat/completions wire format natively, so no translation shim is needed. The
 * only thing pi can't infer is which models a given endpoint serves and how
 * large each model's context window is — this module discovers both from the
 * endpoint's `/v1/models` listing so the `/model` picker can offer real models
 * and pi's native compaction can be sized to the real window.
 */

const MODELS_REQUEST_TIMEOUT_MS = 3000;

export interface OpenAiCompatibleModel {
	id: string;
	// Real context window, when the endpoint advertises one. Servers use
	// different field names: Apfel uses `context_window`, vLLM `max_model_len`.
	contextWindow?: number;
}

function joinUrl( baseUrl: string, path: string ): string {
	return `${ baseUrl.replace( /\/+$/, '' ) }/${ path.replace( /^\/+/, '' ) }`;
}

function authHeaders( apiKey?: string ): Record< string, string > {
	return apiKey ? { authorization: `Bearer ${ apiKey }` } : {};
}

function readContextWindow( entry: Record< string, unknown > ): number | undefined {
	const candidate = entry.context_window ?? entry.max_model_len ?? entry.max_context_length;
	return typeof candidate === 'number' && candidate > 0 ? candidate : undefined;
}

/**
 * List the models an OpenAI-compatible endpoint serves, with each model's
 * context window when advertised. Never throws — returns an empty array if the
 * endpoint is unreachable, slow, or returns an unexpected shape, so a broken
 * endpoint degrades gracefully rather than crashing the caller.
 */
export async function discoverOpenAiCompatibleModels(
	baseUrl: string,
	apiKey?: string
): Promise< OpenAiCompatibleModel[] > {
	try {
		const response = await fetch( joinUrl( baseUrl, '/models' ), {
			headers: authHeaders( apiKey ),
			signal: AbortSignal.timeout( MODELS_REQUEST_TIMEOUT_MS ),
		} );
		if ( ! response.ok ) {
			return [];
		}
		const body = ( await response.json() ) as { data?: Record< string, unknown >[] };
		const entries = Array.isArray( body?.data ) ? body.data : [];
		return entries
			.filter( ( entry ) => typeof entry?.id === 'string' )
			.map( ( entry ) => ( {
				id: entry.id as string,
				contextWindow: readContextWindow( entry ),
			} ) );
	} catch {
		return [];
	}
}

/**
 * Resolve the context window for a specific model on an endpoint, preferring an
 * explicit override, then the endpoint's advertised value, else undefined (the
 * caller falls back to a safe default).
 */
export async function resolveOpenAiCompatibleContextWindow(
	baseUrl: string,
	apiKey: string | undefined,
	modelId: string,
	override?: number
): Promise< number | undefined > {
	if ( typeof override === 'number' && override > 0 ) {
		return override;
	}
	const models = await discoverOpenAiCompatibleModels( baseUrl, apiKey );
	return models.find( ( model ) => model.id === modelId )?.contextWindow;
}
