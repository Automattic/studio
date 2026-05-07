import { getAiModelFamily, type AiModelFamily, type AiModelId } from '@studio/common/ai/models';
import { resolveAiEnvironment } from 'cli/ai/auth';
import type { AiProviderId } from 'cli/ai/providers';

// Hard-coded against the bug_report.yml dropdown labels — keep in sync with
// .github/ISSUE_TEMPLATE/bug_report.yml. Wider unions get rejected by the
// validator below so an off-script model response can't slip into the URL.
export const FEEDBACK_IMPACT_VALUES = [ 'One', 'Some (< 50%)', 'Most (> 50%)', 'All' ] as const;
export type FeedbackImpact = ( typeof FEEDBACK_IMPACT_VALUES )[ number ];

export const FEEDBACK_WORKAROUND_VALUES = [
	'No and the app is unusable',
	'No but the app is still usable',
	'Yes, difficult to implement',
	'Yes, easy to implement',
	'There is no user impact',
] as const;
export type FeedbackWorkaround = ( typeof FEEDBACK_WORKAROUND_VALUES )[ number ];

export interface ExtractedFeedbackFields {
	title: string | null;
	steps: string | null;
	expected: string | null;
	actual: string | null;
	impact: FeedbackImpact | null;
	workaround: FeedbackWorkaround | null;
}

const FEEDBACK_EXTRACTION_TIMEOUT_MS = 10_000;
// Bug reports with steps + expected + actual easily exceed 1024 tokens. A
// truncated response makes JSON.parse fail and the user silently falls back
// to no extraction; bumping the cap costs nothing when the model finishes
// early since billing is per emitted token.
const FEEDBACK_EXTRACTION_MAX_TOKENS = 2048;
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

const FEEDBACK_EXTRACTION_SYSTEM_PROMPT = `You extract structured fields from a Studio AI bug report so a GitHub issue form can be pre-filled.

Respond with ONLY a JSON object matching this shape:
{
  "title": string | null,        // <= 80 chars summarizing the issue
  "steps": string | null,        // reproduction steps if mentioned (markdown numbered list ok)
  "expected": string | null,     // what the user expected to happen
  "actual": string | null,       // what actually happened
  "impact": "One" | "Some (< 50%)" | "Most (> 50%)" | "All" | null,
  "workaround": "No and the app is unusable" | "No but the app is still usable" | "Yes, difficult to implement" | "Yes, easy to implement" | "There is no user impact" | null
}

Rules:
- Use null for any field where the report does NOT clearly express that signal.
- Do NOT invent reproduction steps, expected behavior, or impact scope.
- Preserve the user's language for free-form fields (title, steps, expected, actual).
- For "impact" and "workaround", emit ONLY the exact English literals listed above — even when the report is in another language.
- Output JSON only — no prose, no code fences.`;

interface ExtractFeedbackContext {
	provider: AiProviderId;
	model: AiModelId;
}

/**
 * Run a one-shot, non-streaming extraction call against the user's currently
 * configured AI provider. Supports both Anthropic and OpenAI families through
 * the same wpcom proxy (or direct Anthropic when the user supplies their own
 * key). Returns null on any failure path so the caller can fall back to
 * non-AI defaults instead of breaking the slash command.
 */
export async function extractFeedbackFields(
	description: string,
	ctx: ExtractFeedbackContext
): Promise< ExtractedFeedbackFields | null > {
	let env: Record< string, string >;
	try {
		env = await resolveAiEnvironment( ctx.provider );
	} catch {
		return null;
	}

	const controller = new AbortController();
	const timer = setTimeout( () => controller.abort(), FEEDBACK_EXTRACTION_TIMEOUT_MS );
	try {
		const text = await callExtractionModel(
			getAiModelFamily( ctx.model ),
			ctx.model,
			env,
			description,
			controller.signal
		);
		return text ? parseFeedbackExtraction( text ) : null;
	} catch {
		return null;
	} finally {
		clearTimeout( timer );
	}
}

async function callExtractionModel(
	family: AiModelFamily,
	model: AiModelId,
	env: Record< string, string >,
	description: string,
	signal: AbortSignal
): Promise< string | null > {
	const userMessage = `Bug report:\n"""\n${ description }\n"""`;
	if ( family === 'anthropic' ) {
		return callAnthropicMessages( env, model, userMessage, signal );
	}
	return callOpenAiCompletions( env, model, userMessage, signal );
}

async function callAnthropicMessages(
	env: Record< string, string >,
	model: string,
	userMessage: string,
	signal: AbortSignal
): Promise< string | null > {
	const baseUrl = ( env.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_DEFAULT_BASE_URL ).replace(
		/\/+$/,
		''
	);
	const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim();
	const apiKey = env.ANTHROPIC_API_KEY?.trim();
	if ( ! authToken && ! apiKey ) {
		return null;
	}

	const headers: Record< string, string > = {
		'content-type': 'application/json',
		'anthropic-version': ANTHROPIC_API_VERSION,
		...parseAnthropicLineHeaders( env.ANTHROPIC_CUSTOM_HEADERS ),
	};
	// wpcom routes Anthropic via Bearer; direct Anthropic uses x-api-key.
	if ( authToken ) {
		headers.authorization = `Bearer ${ authToken }`;
	} else if ( apiKey ) {
		headers[ 'x-api-key' ] = apiKey;
	}

	const response = await fetch( `${ baseUrl }/v1/messages`, {
		method: 'POST',
		headers,
		body: JSON.stringify( {
			model,
			max_tokens: FEEDBACK_EXTRACTION_MAX_TOKENS,
			system: FEEDBACK_EXTRACTION_SYSTEM_PROMPT,
			messages: [ { role: 'user', content: userMessage } ],
		} ),
		signal,
	} );
	if ( ! response.ok ) {
		return null;
	}
	const json = ( await response.json() ) as {
		content?: Array< { type?: string; text?: string } >;
	};
	const block = json.content?.find( ( b ) => b.type === 'text' );
	return block?.text ?? null;
}

async function callOpenAiCompletions(
	env: Record< string, string >,
	model: string,
	userMessage: string,
	signal: AbortSignal
): Promise< string | null > {
	const baseUrl = env.OPENAI_BASE_URL?.trim();
	const apiKey = env.OPENAI_API_KEY?.trim();
	if ( ! baseUrl || ! apiKey ) {
		return null;
	}

	const headers: Record< string, string > = {
		'content-type': 'application/json',
		authorization: `Bearer ${ apiKey }`,
		...parseJsonHeaders( env.STUDIO_OPENAI_DEFAULT_HEADERS ),
	};

	const response = await fetch( `${ baseUrl.replace( /\/+$/, '' ) }/chat/completions`, {
		method: 'POST',
		headers,
		body: JSON.stringify( {
			model,
			max_tokens: FEEDBACK_EXTRACTION_MAX_TOKENS,
			// `json_object` forces the model to return parseable JSON; the
			// system prompt's schema then constrains the shape.
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: FEEDBACK_EXTRACTION_SYSTEM_PROMPT },
				{ role: 'user', content: userMessage },
			],
		} ),
		signal,
	} );
	if ( ! response.ok ) {
		return null;
	}
	const json = ( await response.json() ) as {
		choices?: Array< { message?: { content?: string } } >;
	};
	return json.choices?.[ 0 ]?.message?.content ?? null;
}

// `ANTHROPIC_CUSTOM_HEADERS` is encoded by `buildAnthropicCustomHeaders` in
// providers.ts as `Name: Value\nName: Value` — NOT JSON. Mirrors the runtime's
// `parseAnthropicHeaderEnv` so the wpcom feature header reaches the proxy.
function parseAnthropicLineHeaders( raw: string | undefined ): Record< string, string > {
	if ( ! raw ) {
		return {};
	}
	const out: Record< string, string > = {};
	for ( const line of raw.split( '\n' ) ) {
		const idx = line.indexOf( ':' );
		if ( idx <= 0 ) {
			continue;
		}
		const name = line.slice( 0, idx ).trim();
		const value = line.slice( idx + 1 ).trim();
		if ( name && value ) {
			out[ name ] = value;
		}
	}
	return out;
}

// `STUDIO_OPENAI_DEFAULT_HEADERS` is JSON.stringify'd in providers.ts.
function parseJsonHeaders( raw: string | undefined ): Record< string, string > {
	if ( ! raw ) {
		return {};
	}
	try {
		const parsed = JSON.parse( raw );
		return parsed && typeof parsed === 'object' ? ( parsed as Record< string, string > ) : {};
	} catch {
		return {};
	}
}

export function parseFeedbackExtraction( text: string ): ExtractedFeedbackFields | null {
	// Strip code fences if the model wraps its JSON despite the instructions.
	const stripped = text
		.replace( /^```(?:json)?\s*/i, '' )
		.replace( /```\s*$/, '' )
		.trim();

	let parsed: unknown;
	try {
		parsed = JSON.parse( stripped );
	} catch {
		return null;
	}
	if ( ! parsed || typeof parsed !== 'object' ) {
		return null;
	}

	const obj = parsed as Record< string, unknown >;
	return {
		title: sanitizeString( obj.title ),
		steps: sanitizeString( obj.steps ),
		expected: sanitizeString( obj.expected ),
		actual: sanitizeString( obj.actual ),
		impact: matchEnum( obj.impact, FEEDBACK_IMPACT_VALUES ),
		workaround: matchEnum( obj.workaround, FEEDBACK_WORKAROUND_VALUES ),
	};
}

function sanitizeString( value: unknown ): string | null {
	if ( typeof value !== 'string' ) {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function matchEnum< T extends readonly string[] >(
	value: unknown,
	allowed: T
): T[ number ] | null {
	return typeof value === 'string' && ( allowed as readonly string[] ).includes( value )
		? ( value as T[ number ] )
		: null;
}
