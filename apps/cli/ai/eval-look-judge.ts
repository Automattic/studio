/**
 * A blind judge of how a built site looks. A vision model sees only the ask
 * and a screenshot of the home page as a visitor gets it, not how the site
 * was built or by whom, and scores what a person would see: whether the page
 * looks made for this ask or as a theme's default, and whether everything on
 * it can be read. The structural checks in outcome.mjs read WordPress's
 * state; this reads the page.
 *
 * The judge is any model that reads images through the Anthropic Messages
 * API, as Studio's Anthropic provider speaks it: STUDIO_EVAL_JUDGE_BASE_URL,
 * STUDIO_EVAL_JUDGE_API_KEY (or ANTHROPIC_API_KEY) and STUDIO_EVAL_JUDGE_MODEL.
 * Studio's own tiers do not read images (`fast`, packages/common/ai/models.ts).
 */
import { readFileSync } from 'fs';

interface JudgeEndpoint {
	baseUrl: string;
	apiKey: string;
	model: string;
}

/** The judge the environment configures, if any. */
export function judgeEndpoint( env = process.env ): JudgeEndpoint | undefined {
	const apiKey = env.STUDIO_EVAL_JUDGE_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim();
	if ( ! apiKey ) {
		return undefined;
	}
	return {
		baseUrl: ( env.STUDIO_EVAL_JUDGE_BASE_URL?.trim() || 'https://api.anthropic.com' ).replace(
			/\/+$/,
			''
		),
		apiKey,
		model: env.STUDIO_EVAL_JUDGE_MODEL?.trim() || 'claude-sonnet-5',
	};
}

export interface LookJudgement {
	// 1: a theme's default look with the content dropped in; 5: clearly designed for this ask.
	madeForTheAsk: number;
	// Text, buttons or links a visitor cannot read: low contrast, cut off, overlapping.
	unreadable: string[];
	// Anything else a visitor would see as broken or unfinished.
	defects: string[];
	reason: string;
}

const INSTRUCTIONS = `You judge websites from a screenshot of their home page, the way a visitor and a designer would. You are told what the site owner asked for.

Score madeForTheAsk from 1 to 5:
1 = a stock theme's default look (its default fonts, colors and layout) with the owner's text and pictures dropped in.
3 = some choices of its own (palette, type or layout) but much of it still reads as a default template.
5 = clearly designed for this business: its palette, type, imagery and layout fit what was asked.

List in unreadable each piece of text, button or link a visitor cannot read: text the same or nearly the same color as what is behind it, text cut off, overlapping, or broken mid-word.
List in defects anything else a visitor would see as broken or unfinished: placeholder text or links, a duplicated header or footer, empty sections, broken images, a business name that does not match the ask.

Answer with only a JSON object: {"madeForTheAsk": <1-5>, "unreadable": [<strings>], "defects": [<strings>], "reason": "<one or two sentences>"}`;

/** Judges `screenshot` (a JPEG, as eval-outcome.ts saves it) as the site built for `ask`. */
export async function judgeLook(
	judge: JudgeEndpoint,
	ask: string,
	screenshot: string
): Promise< LookJudgement > {
	const image = readFileSync( screenshot );
	const response = await fetch( `${ judge.baseUrl }/v1/messages`, {
		method: 'POST',
		headers: {
			'x-api-key': judge.apiKey,
			'anthropic-version': '2023-06-01',
			'content-type': 'application/json',
		},
		body: JSON.stringify( {
			model: judge.model,
			max_tokens: 4096,
			system: INSTRUCTIONS,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: `The site owner asked: ${ ask.trim() }` },
						{
							type: 'image',
							source: {
								type: 'base64',
								media_type: 'image/jpeg',
								data: image.toString( 'base64' ),
							},
						},
					],
				},
			],
		} ),
		signal: AbortSignal.timeout( 120_000 ),
	} );
	if ( ! response.ok ) {
		throw new Error( `the judge answered ${ response.status }: ${ await response.text() }` );
	}
	const body = ( await response.json() ) as { content: { type: string; text?: string }[] };
	const text = body.content.map( ( part ) => part.text ?? '' ).join( '' );
	return JSON.parse(
		text.slice( text.indexOf( '{' ), text.lastIndexOf( '}' ) + 1 )
	) as LookJudgement;
}
