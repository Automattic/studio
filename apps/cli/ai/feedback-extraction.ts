import Anthropic from '@anthropic-ai/sdk';
import { getAiModelFamily, type AiModelId } from '@studio/common/ai/models';
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

const FEEDBACK_EXTRACTION_TIMEOUT_MS = 15_000;
const FEEDBACK_EXTRACTION_MAX_TOKENS = 1024;

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
- Output JSON only — no prose, no code fences.`;

interface ExtractFeedbackContext {
	provider: AiProviderId;
	model: AiModelId;
}

/**
 * Run a one-shot, non-streaming extraction call against the user's currently
 * configured AI provider. Returns null on any failure path (unsupported
 * model family, missing credentials, network/timeout, malformed JSON) so the
 * caller can fall back to non-AI defaults instead of breaking the slash
 * command.
 */
export async function extractFeedbackFields(
	description: string,
	ctx: ExtractFeedbackContext
): Promise< ExtractedFeedbackFields | null > {
	// Anthropic-only for v1 — the OpenAI path would need a different SDK
	// surface and isn't worth the extra dep+auth plumbing yet.
	if ( getAiModelFamily( ctx.model ) !== 'anthropic' ) {
		return null;
	}

	let env: Record< string, string >;
	try {
		env = await resolveAiEnvironment( ctx.provider );
	} catch {
		return null;
	}

	const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim();
	const apiKey = env.ANTHROPIC_API_KEY?.trim();
	if ( ! authToken && ! apiKey ) {
		return null;
	}

	const client = new Anthropic( {
		apiKey: apiKey ?? null,
		authToken: authToken ?? undefined,
		baseURL: env.ANTHROPIC_BASE_URL,
		defaultHeaders: parseAnthropicHeaders( env.ANTHROPIC_CUSTOM_HEADERS ),
		dangerouslyAllowBrowser: true,
	} );

	const controller = new AbortController();
	const timer = setTimeout( () => controller.abort(), FEEDBACK_EXTRACTION_TIMEOUT_MS );

	try {
		const response = await client.messages.create(
			{
				model: ctx.model,
				max_tokens: FEEDBACK_EXTRACTION_MAX_TOKENS,
				system: FEEDBACK_EXTRACTION_SYSTEM_PROMPT,
				messages: [
					{
						role: 'user',
						content: `Bug report:\n"""\n${ description }\n"""`,
					},
				],
			},
			{ signal: controller.signal }
		);
		const text = response.content
			.filter(
				( block ): block is Extract< typeof block, { type: 'text' } > => block.type === 'text'
			)
			.map( ( block ) => block.text )
			.join( '\n' )
			.trim();
		return parseFeedbackExtraction( text );
	} catch {
		return null;
	} finally {
		clearTimeout( timer );
	}
}

function parseAnthropicHeaders( raw: string | undefined ): Record< string, string > | undefined {
	if ( ! raw ) {
		return undefined;
	}
	try {
		const parsed = JSON.parse( raw );
		return parsed && typeof parsed === 'object'
			? ( parsed as Record< string, string > )
			: undefined;
	} catch {
		return undefined;
	}
}

export function parseFeedbackExtraction( text: string ): ExtractedFeedbackFields | null {
	// Strip code fences if the model wrapped its JSON despite the instructions.
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
