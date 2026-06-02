import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, DEFAULT_MODEL, type AiModelId } from '@studio/common/ai/models';
import { resolveAiEnvironment, resolveInitialAiProvider } from 'cli/ai/auth';

/**
 * Generation LLM client used by the wordpress-site-generator tools.
 *
 * The agent runtime (runtimes/pi) builds its own streaming model from a
 * resolved provider environment. The generation tools run their own
 * (non-streaming, parallel) model calls inside tool handlers, so they resolve
 * the same provider environment independently and construct a plain
 * `@anthropic-ai/sdk` client from it — mirroring `createWpcomAnthropicProviderConfig`
 * in runtimes/pi. This works for both the wpcom proxy (bearer auth +
 * X-WPCOM-AI-Feature header) and a direct Anthropic API key.
 */

const GENERATION_MAX_TOKENS = 16_000;

// ANTHROPIC_CUSTOM_HEADERS is a newline-delimited `Name: value` string (see
// providers.ts / runtimes/pi parseAnthropicHeaderEnv). Reproduced here so the
// generation client sends the same X-WPCOM-AI-Feature header as the agent.
function parseAnthropicHeaderEnv(
	value: string | undefined
): Record< string, string > | undefined {
	if ( ! value ) {
		return undefined;
	}
	const out: Record< string, string > = {};
	for ( const line of value.split( '\n' ) ) {
		const idx = line.indexOf( ':' );
		if ( idx <= 0 ) {
			continue;
		}
		const name = line.slice( 0, idx ).trim();
		const v = line.slice( idx + 1 ).trim();
		if ( name && v ) {
			out[ name ] = v;
		}
	}
	return Object.keys( out ).length ? out : undefined;
}

interface GenerationClient {
	client: Anthropic;
	model: AiModelId;
}

let cached: GenerationClient | null = null;

function resolveGenerationModel(): AiModelId {
	const override = process.env.STUDIO_WSG_MODEL?.trim();
	if ( override && AI_MODELS.some( ( m ) => m.id === override && m.family === 'anthropic' ) ) {
		return override as AiModelId;
	}
	return DEFAULT_MODEL;
}

async function getClient(): Promise< GenerationClient > {
	if ( cached ) {
		return cached;
	}

	const provider = await resolveInitialAiProvider();
	const env = await resolveAiEnvironment( provider );

	const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim();
	const apiKey = env.ANTHROPIC_API_KEY?.trim();
	if ( ! authToken && ! apiKey ) {
		throw new Error(
			'WordPress.com login required for site generation. Run /login to authenticate, or switch to the Anthropic API key provider with /provider.'
		);
	}

	const baseURL = env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
	const defaultHeaders = parseAnthropicHeaderEnv( env.ANTHROPIC_CUSTOM_HEADERS );

	const client = new Anthropic( {
		apiKey: authToken ? null : apiKey ?? null,
		authToken: authToken ?? undefined,
		baseURL,
		defaultHeaders,
		dangerouslyAllowBrowser: true,
	} );

	// Only cache on success so a pre-login failure doesn't pin a broken client.
	cached = { client, model: resolveGenerationModel() };
	return cached;
}

export interface CompleteTextOptions {
	system: string;
	user: string;
	maxTokens?: number;
	temperature?: number;
}

// Statuses worth retrying: rate limits, gateway/proxy hiccups, and Anthropic's
// 529 "overloaded". The WordPress.com AI proxy occasionally returns a 503 HTML
// page on transient load; without a retry that aborts a whole long-running
// generation (e.g. seeding many pages).
const TRANSIENT_STATUSES = new Set( [ 408, 409, 425, 429, 500, 502, 503, 504, 529 ] );
const TRANSIENT_MESSAGE_RE =
	/\b(429|500|502|503|504|529)\b|overloaded|rate.?limit|temporarily unavailable|service unavailable|gateway|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN/i;

export function isTransientError( error: unknown ): boolean {
	const status = ( error as { status?: number } )?.status;
	if ( typeof status === 'number' && TRANSIENT_STATUSES.has( status ) ) {
		return true;
	}
	const message = error instanceof Error ? error.message : String( error );
	return TRANSIENT_MESSAGE_RE.test( message );
}

function sleep( ms: number ): Promise< void > {
	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

export async function withTransientRetry< T >( fn: () => Promise< T > ): Promise< T > {
	const maxAttempts = 5;
	let lastError: unknown;
	for ( let attempt = 1; attempt <= maxAttempts; attempt++ ) {
		try {
			return await fn();
		} catch ( error ) {
			lastError = error;
			if ( attempt === maxAttempts || ! isTransientError( error ) ) {
				throw error;
			}
			// Exponential backoff with jitter (1.5s, 3s, 6s, 12s, capped at 20s)
			// to ride out a transient proxy outage without a thundering herd.
			const backoff = Math.min( 1500 * 2 ** ( attempt - 1 ), 20_000 );
			await sleep( backoff + Math.floor( Math.random() * 500 ) );
		}
	}
	throw lastError;
}

export async function completeText( opts: CompleteTextOptions ): Promise< string > {
	const { client, model } = await getClient();
	const response = await withTransientRetry( () =>
		client.messages.create( {
			model,
			max_tokens: opts.maxTokens ?? GENERATION_MAX_TOKENS,
			temperature: opts.temperature ?? 0.7,
			system: opts.system,
			messages: [ { role: 'user', content: opts.user } ],
		} )
	);

	return response.content
		.map( ( block ) => ( block.type === 'text' ? block.text : '' ) )
		.join( '' )
		.trim();
}

/**
 * Run async tasks with a bounded concurrency. The site-generator fans out one
 * model call per theme file; a small pool keeps us well under provider rate
 * limits while still parallelising the bulk of the work.
 */
export async function runPooled< T >(
	tasks: Array< () => Promise< T > >,
	concurrency = 4
): Promise< T[] > {
	const results: T[] = new Array( tasks.length );
	let next = 0;

	async function worker(): Promise< void > {
		for (;;) {
			const index = next++;
			if ( index >= tasks.length ) {
				return;
			}
			results[ index ] = await tasks[ index ]();
		}
	}

	const workerCount = Math.max( 1, Math.min( concurrency, tasks.length ) );
	await Promise.all( Array.from( { length: workerCount }, () => worker() ) );
	return results;
}

/**
 * Models occasionally wrap output in a Markdown code fence despite being told
 * not to. Strip a single outer fence so the raw file content is written as-is.
 */
export function stripCodeFences( text: string ): string {
	let trimmed = text.trim();
	// Tolerate a closing fence with no preceding newline (e.g. "```json\n{...}```")
	// and trailing whitespace, which models emit on the JSON paths.
	const full = trimmed.match( /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n?```$/ );
	if ( full ) {
		return full[ 1 ].trim();
	}
	// Opening fence with no (or a truncated) closing fence: drop the leading
	// ```lang line and any dangling closing fence so the inner content survives.
	trimmed = trimmed.replace( /^```[a-zA-Z0-9_-]*\n/, '' ).replace( /\n?```$/, '' );
	return trimmed.trim();
}

/**
 * Extracts a JSON value (object or array) from model output that may be wrapped
 * in a code fence and/or surrounded by stray prose. Slices from the first
 * opening bracket to the last matching closing bracket — robust to fences the
 * model added or a leading sentence like "Here is the manifest:".
 */
export function extractJson( text: string ): string {
	const unfenced = stripCodeFences( text );
	const firstObj = unfenced.indexOf( '{' );
	const firstArr = unfenced.indexOf( '[' );
	if ( firstObj === -1 && firstArr === -1 ) {
		return unfenced;
	}
	let start: number;
	let close: string;
	if ( firstArr === -1 || ( firstObj !== -1 && firstObj < firstArr ) ) {
		start = firstObj;
		close = '}';
	} else {
		start = firstArr;
		close = ']';
	}
	const end = unfenced.lastIndexOf( close );
	return end > start ? unfenced.slice( start, end + 1 ) : unfenced;
}

// Test seam: lets unit tests reset the memoised client between cases.
export function __resetGenerationClientForTests(): void {
	cached = null;
}
