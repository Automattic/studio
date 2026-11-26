// How the connector talks to the user's server: its OpenAI-compatible API under `/v1`, which every
// server it supports answers, and, at the server's root, the APIs of the products that say more
// about a model than `/v1` does. Studio never asks which product runs the server: it reads what
// the server answers.

import { getServerAddress } from './descriptor';

const LIST_TIMEOUT_MS = 10_000;
const FACTS_TIMEOUT_MS = 10_000;
// Loading a large model takes a while; the turn's own request would wait for it all the same.
const LOAD_TIMEOUT_MS = 300_000;

// Nothing answered at the address, or what answered isn't a server that lists models.
class UnreachableServerError extends Error {}

// The server refused the key, or asked for one it wasn't given.
export class RefusedKeyError extends Error {}

/**
 * The server's OpenAI-compatible API for an address as servers print or document it: with or
 * without a scheme (`http://` when it has none), at the server's root or at `/v1`. Undefined when
 * it isn't an address.
 */
export function toApiBase( address: string ): string | undefined {
	try {
		const url = new URL(
			/^[a-z][a-z\d+.-]*:\/\//i.test( address ) ? address : `http://${ address }`
		);
		const path = url.pathname.replace( /\/+$/, '' );
		return `${ url.origin }${ path.endsWith( '/v1' ) ? path : `${ path }/v1` }`;
	} catch {
		return undefined;
	}
}

async function request(
	url: string,
	apiKey: string | undefined,
	timeout: number,
	body?: unknown
): Promise< Response > {
	return fetch( url, {
		method: body === undefined ? 'GET' : 'POST',
		headers: {
			...( apiKey ? { Authorization: `Bearer ${ apiKey }` } : {} ),
			...( body === undefined ? {} : { 'Content-Type': 'application/json' } ),
		},
		body: body === undefined ? undefined : JSON.stringify( body ),
		signal: AbortSignal.timeout( timeout ),
	} );
}

// A product API's answer, or undefined when the server doesn't answer it.
async function readJson(
	url: string,
	apiKey: string | undefined,
	timeout: number,
	body?: unknown
) {
	try {
		const response = await request( url, apiKey, timeout, body );
		return response.ok ? ( ( await response.json() ) as unknown ) : undefined;
	} catch {
		return undefined;
	}
}

// One entry of `/v1/models`. llama-server and vLLM add facts to it.
interface ModelEntry {
	id: string;
	// llama-server: what the model reads, always with `text`.
	architecture?: { input_modalities?: unknown };
	// llama-server: the context it runs the model with.
	meta?: { n_ctx?: unknown } | null;
	// vLLM: the context it runs the model with.
	max_model_len?: unknown;
}

/**
 * The models the server lists at `/v1/models`, in its order. Throws `UnreachableServerError` when
 * nothing answers or the answer isn't a model list, and `RefusedKeyError` when the server refuses
 * the key.
 */
export async function fetchModelEntries(
	baseUrl: string,
	apiKey: string | undefined
): Promise< ModelEntry[] > {
	const response = await request( `${ baseUrl }/models`, apiKey, LIST_TIMEOUT_MS ).catch( () => {
		throw new UnreachableServerError();
	} );
	if ( response.status === 401 || response.status === 403 ) {
		throw new RefusedKeyError();
	}
	const list = response.ok ? await response.json().catch( () => undefined ) : undefined;
	const data = ( list as { data?: unknown } | undefined )?.data;
	if ( data === null ) {
		return [];
	}
	if ( ! Array.isArray( data ) ) {
		throw new UnreachableServerError();
	}
	return data.filter(
		( entry ): entry is ModelEntry => typeof entry?.id === 'string' && entry.id.length > 0
	);
}

// What the server says about a model. A fact it doesn't say is undefined.
interface ModelFacts {
	images?: boolean;
	// It only makes embeddings, so no chat runs on it.
	embeddingOnly?: boolean;
	tools?: boolean;
	// The context it runs the model with.
	context?: number;
}

function positive( value: unknown ): number | undefined {
	return typeof value === 'number' && value > 0 ? value : undefined;
}

// llama-server and vLLM say what they know in the model's `/v1/models` entry.
function readEntryFacts( entry: ModelEntry ): ModelFacts {
	const modalities = entry.architecture?.input_modalities;
	return {
		images: Array.isArray( modalities ) ? modalities.includes( 'image' ) : undefined,
		context: positive( entry.meta?.n_ctx ) ?? positive( entry.max_model_len ),
	};
}

// Ollama's `/api/show` lists what a model can do.
async function readOllamaFacts(
	root: string,
	apiKey: string | undefined,
	name: string
): Promise< ModelFacts | undefined > {
	const show = ( await readJson( `${ root }/api/show`, apiKey, FACTS_TIMEOUT_MS, {
		model: name,
	} ) ) as { capabilities?: unknown } | undefined;
	const capabilities = show?.capabilities;
	if ( ! Array.isArray( capabilities ) ) {
		return undefined;
	}
	return {
		images: capabilities.includes( 'vision' ),
		embeddingOnly:
			capabilities.length > 0 && capabilities.every( ( capability ) => capability === 'embedding' ),
		tools: capabilities.includes( 'tools' ),
	};
}

// Ollama reports the context it runs a model with only while the model is loaded (`/api/ps`).
async function readOllamaContext(
	root: string,
	apiKey: string | undefined,
	name: string
): Promise< number | undefined > {
	const running = async () => {
		const ps = ( await readJson( `${ root }/api/ps`, apiKey, FACTS_TIMEOUT_MS ) ) as
			| { models?: { name?: unknown; model?: unknown; context_length?: unknown }[] }
			| undefined;
		const model = ps?.models?.find( ( candidate ) =>
			[ candidate.name, candidate.model ].includes( name )
		);
		return positive( model?.context_length );
	};
	const loaded = await running();
	if ( loaded ) {
		return loaded;
	}
	// A request that names only the model loads it, as the turn's request would.
	await readJson( `${ root }/api/generate`, apiKey, LOAD_TIMEOUT_MS, { model: name } );
	return running();
}

interface LmStudioModel {
	type?: unknown;
	key?: unknown;
	loaded_instances?: { id?: unknown; config?: { context_length?: unknown } }[];
	capabilities?: { vision?: unknown; trained_for_tool_use?: unknown };
}

// LM Studio's `/api/v1/models` says what each model reads and does, and the context of each
// instance it has loaded.
async function readLmStudioModels(
	root: string,
	apiKey: string | undefined
): Promise< LmStudioModel[] | undefined > {
	const list = ( await readJson( `${ root }/api/v1/models`, apiKey, FACTS_TIMEOUT_MS ) ) as
		| { models?: unknown }
		| undefined;
	return Array.isArray( list?.models ) ? list.models : undefined;
}

function readLmStudioFacts( models: LmStudioModel[], name: string ): ModelFacts | undefined {
	const model = models.find(
		( candidate ) =>
			candidate.key === name ||
			candidate.loaded_instances?.some( ( instance ) => instance.id === name )
	);
	if ( ! model ) {
		return undefined;
	}
	const instance =
		model.loaded_instances?.find( ( candidate ) => candidate.id === name ) ??
		model.loaded_instances?.[ 0 ];
	return {
		images: model.capabilities?.vision === true,
		embeddingOnly: model.type === 'embedding',
		tools: model.capabilities?.trained_for_tool_use === true,
		context: positive( instance?.config?.context_length ),
	};
}

// LM Studio loads a chat model on a request for it, with the idle TTL and auto-evict it gives models
// loaded that way. Its load API would keep the model loaded until someone unloads it.
async function loadLmStudioModel( baseUrl: string, apiKey: string | undefined, name: string ) {
	await readJson( `${ baseUrl }/chat/completions`, apiKey, LOAD_TIMEOUT_MS, {
		model: name,
		messages: [ { role: 'user', content: 'Hi' } ],
		max_tokens: 1,
	} );
}

/**
 * What the server says about each model: its `/v1/models` entry first, then the product API its
 * root answers. `context` asks for the context it runs the model with, which on Ollama and LM
 * Studio loads a model that isn't loaded first.
 */
export async function readModelFacts(
	baseUrl: string,
	apiKey: string | undefined,
	entries: ModelEntry[],
	{ context = false }: { context?: boolean } = {}
): Promise< ModelFacts[] > {
	const root = getServerAddress( baseUrl );
	const fromEntries = entries.map( readEntryFacts );
	if ( fromEntries.every( ( facts ) => facts.images !== undefined ) ) {
		return fromEntries;
	}
	const ollama = await Promise.all(
		entries.map( ( { id } ) => readOllamaFacts( root, apiKey, id ) )
	);
	if ( ollama.some( Boolean ) ) {
		return Promise.all(
			entries.map( async ( { id }, index ) => ( {
				...fromEntries[ index ],
				...ollama[ index ],
				...( context ? { context: await readOllamaContext( root, apiKey, id ) } : {} ),
			} ) )
		);
	}
	let lmStudio = await readLmStudioModels( root, apiKey );
	const unloaded = entries.filter( ( { id } ) => {
		const facts = lmStudio && readLmStudioFacts( lmStudio, id );
		return context && facts && ! facts.embeddingOnly && ! facts.context;
	} );
	if ( unloaded.length ) {
		await Promise.all( unloaded.map( ( { id } ) => loadLmStudioModel( baseUrl, apiKey, id ) ) );
		lmStudio = ( await readLmStudioModels( root, apiKey ) ) ?? lmStudio;
	}
	return entries.map( ( { id }, index ) => ( {
		...fromEntries[ index ],
		...( lmStudio && readLmStudioFacts( lmStudio, id ) ),
	} ) );
}

/**
 * The models the server offers for chat: those it lists at `/v1/models`, in its order, less those
 * it says only make embeddings, each with what it says about it. Throws as `fetchModelEntries`.
 */
export async function fetchChatModels(
	baseUrl: string,
	apiKey: string | undefined
): Promise< { id: string; facts: ModelFacts }[] > {
	const entries = await fetchModelEntries( baseUrl, apiKey );
	const facts = await readModelFacts( baseUrl, apiKey, entries );
	return entries
		.map( ( { id }, index ) => ( { id, facts: facts[ index ] } ) )
		.filter( ( { facts: { embeddingOnly } } ) => ! embeddingOnly );
}
