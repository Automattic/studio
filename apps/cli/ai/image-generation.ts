import { readAuthToken } from '@studio/common/lib/shared-config';
import { getWpcomAiGatewayBaseUrl } from 'cli/ai/providers';

/**
 * AI image generation through the WP.com AI proxy's Google Vertex Gemini route.
 *
 * A TypeScript port of minimalistic-site-builder's image subsystem
 * (GeminiImage / WpcomImageClient / ImagePromptComposer), trimmed for an
 * agentic host: the agent authors each image spec at call time following the
 * `imagery` skill's rules, so the builder's deterministic prompt-sanitization
 * machinery (grade-token stripping, pictorial page-context recasting) is
 * replaced by authoring guidance, and its LLM prompt-repair pass is replaced by
 * reporting safety-filtered failures back to the agent to rewrite and retry.
 * Only JPEG output is supported — the skill forbids decorative/transparent
 * imagery, which is what PNG output existed for.
 */

const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image';
// Slug already allowlisted on the proxy's Google publisher route (shared with
// the site builder and telex, which generate theme images the same way).
const IMAGE_FEATURE_SLUG = 'builder-theme-image';
const MAX_CONCURRENT_REQUESTS = 5;
const RETRY_DELAYS_SECONDS = [ 2, 5, 12 ];
// Prompt budget inherited from the builder: Gemini accepts longer prompts, but
// a tight prompt keeps the subject dominant instead of drowning it in context.
export const MAX_PROMPT_TOKENS = 480;

export const IMAGE_STYLES = [
	'photorealistic',
	'digital-art',
	'illustration',
	'minimalist',
	'flat-design',
	'3d-render',
	'abstract',
	'watercolor',
] as const;
export type ImageStyle = ( typeof IMAGE_STYLES )[ number ];

const ASPECT_RATIO_BY_KEYWORD = {
	square: '1:1',
	landscape: '16:9',
	ultrawide: '21:9',
	portrait: '9:16',
	'card-landscape': '4:3',
	'card-portrait': '3:4',
} as const;
export const IMAGE_ASPECT_RATIOS = Object.keys(
	ASPECT_RATIO_BY_KEYWORD
) as ImageAspectRatioKeyword[];
export type ImageAspectRatioKeyword = keyof typeof ASPECT_RATIO_BY_KEYWORD;

// Gemini outcomes that unambiguously mean a policy/safety filter rejected the
// prompt. Everything else (MAX_TOKENS, NO_IMAGE, …) is an ordinary no-image
// response and must not be reported as repairable-by-rewriting.
const FILTERED_REASONS = new Set( [
	'SAFETY',
	'RECITATION',
	'BLOCKLIST',
	'PROHIBITED_CONTENT',
	'SPII',
	'IMAGE_SAFETY',
	'IMAGE_PROHIBITED_CONTENT',
	'IMAGE_RECITATION',
	'MODEL_ARMOR',
] );

/**
 * Whether the generate_images capability is enabled for this process.
 *
 * Gated on the explicit token until the WP.com AI proxy accepts Studio user
 * OAuth tokens on the Google publisher route (they currently get a 403 with
 * every Studio feature slug). resolveImageAuthToken already prefers the env
 * token and falls back to the WP.com login, so once the proxy-side allowlist
 * lands this check is the only thing to relax.
 */
export function isImageGenerationAvailable(): boolean {
	return Boolean( process.env.STUDIO_IMAGE_API_TOKEN?.trim() );
}

async function resolveImageAuthToken(): Promise< string > {
	const envToken = process.env.STUDIO_IMAGE_API_TOKEN?.trim();
	if ( envToken ) {
		return envToken;
	}
	const token = await readAuthToken();
	if ( ! token?.accessToken ) {
		throw new Error(
			'Image generation requires a WordPress.com login (studio auth login) or STUDIO_IMAGE_API_TOKEN.'
		);
	}
	return token.accessToken;
}

function getImageModel(): string {
	return process.env.STUDIO_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

function getImageEndpoint(): string {
	const base = getWpcomAiGatewayBaseUrl().replace( /\/+$/, '' );
	return `${ base }/v1/publishers/google/models/${ getImageModel() }:generateContent`;
}

export function resolveAspectRatio( keyword: string | undefined ): string {
	return ASPECT_RATIO_BY_KEYWORD[ ( keyword ?? 'landscape' ) as ImageAspectRatioKeyword ] ?? '16:9';
}

// Wide ratios are used full-bleed (heroes, banners) where a 1K render goes
// soft; the smaller contained slots stay at 1K to keep cost down.
function imageSizeForRatio( aspectRatio: string ): '1K' | '2K' {
	return aspectRatio === '16:9' || aspectRatio === '21:9' ? '2K' : '1K';
}

export interface ImagePromptSpec {
	subject: string;
	pageContext?: string;
	style?: string;
}

export interface ImagePromptContext {
	siteContext?: string;
	imageGrade?: string;
}

// Text-carrying objects the image model reliably completes with garbled fake
// lettering. Deliberately a noun allowlist: a false positive only adds a
// harmless render instruction, while an unconditional clause would plant the
// signage concept into clean prompts. English + Spanish, like the builder.
const TEXT_CARRIER_PATTERN =
	/\b(?:signs?|signages?|signboards?|storefronts?|shop ?fronts?|facades?|fa[çc]ades?|marquees?|billboards?|posters?|placards?|banners?|plaques?|awnings?|men[uú]s?|menu ?boards?|chalkboards?|blackboards?|whiteboards?|screens?|smartphones?|phones?|tablets?|laptops?|monitors?|dashboards?|newspapers?|magazines?|books?|labels?|packagings?|record ?sleeves?|album ?covers?|letreros?|carteles?|pancartas?|r[oó]tulos?|vallas?|marquesinas?|toldos?|pizarras?|pantallas?|tel[eé]fonos?|m[oó]viles?|peri[oó]dicos?|revistas?|libros?|etiquetas?|placas?|fachadas?|portadas?|escaparates?)\b/iu;

function estimateTokens( text: string ): number {
	const trimmed = text.trim();
	if ( ! trimmed ) {
		return 0;
	}
	const words = trimmed.split( /\s+/ ).length;
	return Math.max( Math.ceil( words * 1.4 ), Math.ceil( trimmed.length / 4 ) );
}

// Trim from the end on word boundaries; the subject leads the prompt, so this
// sheds trailing context first and preserves the subject.
export function fitToTokens( text: string, maxTokens: number ): string {
	if ( estimateTokens( text ) <= maxTokens ) {
		return text;
	}
	const words = text.trim().split( /\s+/ );
	while ( words.length && estimateTokens( words.join( ' ' ) ) > maxTokens ) {
		words.pop();
	}
	return words.join( ' ' ).replace( /[ ,.;:—-]+$/, '' );
}

/**
 * Compose the text prompt for one image. Subject and style are what the model
 * renders; the site-wide grade is a render instruction shared by all imagery so
 * independently generated images read as one photographic series; page and site
 * context only steer subject choice, mood, and composition — the guidance frame
 * states so explicitly, and the no-text guard describes reserved regions
 * positively (continuous empty scenery) rather than enumerating forbidden text
 * artifacts, which image models follow unreliably as negations.
 */
export function composeImagePrompt(
	spec: ImagePromptSpec,
	context: ImagePromptContext = {}
): string {
	const subject = spec.subject.trim();
	const style = spec.style?.trim() ?? '';
	const pageContext = spec.pageContext?.trim().replace( /\.$/, '' ) ?? '';
	const siteContext = context.siteContext?.trim() ?? '';
	const imageGrade = context.imageGrade?.trim() ?? '';

	const parts = [ style ? `${ subject }. Style: ${ style }` : subject ];

	if ( imageGrade ) {
		parts.push( `Art direction for all site imagery: ${ imageGrade.replace( /\.$/, '' ) }.` );
	}

	if ( TEXT_CARRIER_PATTERN.test( subject ) ) {
		parts.push(
			'Any sign, board, screen or printed surface in the scene is quiet set dressing: its face is unmarked — bare wood, clear glass, dark glass or blank chalk — or kept so distant, obliquely angled or softly out of focus that it reads as simple shapes, glare and texture, and the image tells its story through form, light and color alone.'
		);
	}

	const where = [ pageContext ? `Composition: ${ pageContext }.` : '', siteContext ]
		.filter( Boolean )
		.join( ' ' );
	if ( where ) {
		parts.push(
			'Purely pictorial imagery: every part of the frame is the scene itself, and any region described below as open, calm or low-detail is continuous unbroken scenery — open sky, plain wall, still water, bare ground or soft-focus depth — left completely empty. The notes below steer subject, mood and composition only and are never depicted literally: ' +
				where
		);
	}

	return fitToTokens( parts.join( '\n\n' ), MAX_PROMPT_TOKENS );
}

export function buildImageRequestBody(
	prompt: string,
	aspectRatioKeyword: string | undefined
): Record< string, unknown > {
	const aspectRatio = resolveAspectRatio( aspectRatioKeyword );
	return {
		contents: [ { role: 'user', parts: [ { text: prompt } ] } ],
		generationConfig: {
			// TEXT rides along because not every Gemini image model accepts an
			// IMAGE-only response; interpretation scans past text parts.
			responseModalities: [ 'TEXT', 'IMAGE' ],
			imageConfig: {
				aspectRatio,
				imageSize: imageSizeForRatio( aspectRatio ),
				imageOutputOptions: { mimeType: 'image/jpeg', compressionQuality: 85 },
			},
		},
	};
}

export class TransientImageError extends Error {}
export class ImageFilteredError extends Error {}

interface GeminiResponsePart {
	thought?: boolean;
	text?: string;
	inlineData?: { data?: string; mimeType?: string };
	inline_data?: { data?: string; mimeType?: string };
}

interface GeminiResponse {
	promptFeedback?: { blockReason?: string };
	candidates?: Array< {
		finishReason?: string;
		finishMessage?: string;
		content?: { parts?: GeminiResponsePart[] };
	} >;
}

function imagePartData( data: GeminiResponse ): string | null {
	for ( const candidate of data.candidates ?? [] ) {
		for ( const part of candidate.content?.parts ?? [] ) {
			// Gemini 3 may include internal `thought: true` image parts before
			// the authored result; those are never a deliverable asset.
			if ( part.thought === true ) {
				continue;
			}
			const inline = part.inlineData ?? part.inline_data;
			if ( inline?.data ) {
				return inline.data;
			}
		}
	}
	return null;
}

function filteredReason( data: GeminiResponse ): string | null {
	if ( imagePartData( data ) !== null ) {
		return null;
	}
	const block = data.promptFeedback?.blockReason?.toUpperCase().trim();
	if ( block && FILTERED_REASONS.has( block ) ) {
		return `prompt blocked: ${ block }`;
	}
	for ( const candidate of data.candidates ?? [] ) {
		const finish = candidate.finishReason?.toUpperCase().trim();
		if ( finish && FILTERED_REASONS.has( finish ) ) {
			return `candidate finished: ${ finish }`;
		}
	}
	return null;
}

function noImageReason( data: GeminiResponse ): string {
	for ( const candidate of data.candidates ?? [] ) {
		const finish = candidate.finishReason?.trim();
		const text = candidate.content?.parts
			?.map( ( part ) => part.text?.trim() )
			.find( ( value ) => value );
		if ( finish && finish.toUpperCase() !== 'STOP' ) {
			return `candidate finished: ${ finish }${ text ? `; text: ${ text.slice( 0, 200 ) }` : '' }`;
		}
		if ( text ) {
			return `text-only response: ${ text.slice( 0, 200 ) }`;
		}
	}
	return 'no candidates';
}

/**
 * Interpret a completed transfer: HTTP-status classification plus
 * generateContent body parsing. Returns decoded JPEG bytes or throws
 * TransientImageError (429/5xx — retryable), ImageFilteredError (safety filter
 * — retryable, and repairable by rewriting the subject), or Error (permanent).
 */
export function interpretImageResponse( raw: string, status: number ): Buffer {
	if ( status === 429 || status >= 500 ) {
		throw new TransientImageError( `HTTP ${ status }: ${ raw.slice( 0, 300 ) }` );
	}
	if ( status < 200 || status >= 300 ) {
		throw new Error( `Image proxy HTTP ${ status }: ${ raw.slice( 0, 500 ) }` );
	}

	let data: GeminiResponse;
	try {
		data = JSON.parse( raw ) as GeminiResponse;
	} catch {
		throw new Error( `Image proxy returned non-JSON response: ${ raw.slice( 0, 300 ) }` );
	}

	const filtered = filteredReason( data );
	if ( filtered ) {
		throw new ImageFilteredError( `Image safety filter rejected the prompt: ${ filtered }` );
	}

	const base64 = imagePartData( data );
	if ( ! base64 ) {
		throw new Error( `Image proxy response had no image data: ${ noImageReason( data ) }` );
	}

	const bytes = Buffer.from( base64, 'base64' );
	// Byte magic is the source of truth: never deliver non-JPEG bytes under a
	// .jpg filename, whatever the response metadata declares.
	if ( bytes.length < 4 || bytes[ 0 ] !== 0xff || bytes[ 1 ] !== 0xd8 || bytes[ 2 ] !== 0xff ) {
		throw new Error( 'Image proxy returned bytes that are not a JPEG' );
	}
	return bytes;
}

export interface GenerateImageRequest {
	prompt: string;
	aspectRatio?: string;
}

export interface GenerateImageResult {
	ok: boolean;
	bytes?: Buffer;
	error?: string;
	filtered?: boolean;
}

const sleep = ( seconds: number ) =>
	new Promise< void >( ( resolve ) => setTimeout( resolve, seconds * 1000 ) );

async function generateOne(
	endpoint: string,
	authToken: string,
	request: GenerateImageRequest
): Promise< GenerateImageResult > {
	const body = JSON.stringify( buildImageRequestBody( request.prompt, request.aspectRatio ) );
	// Transient transport errors AND safety-filtered prompts retry: the
	// non-deterministic filter can pass the same prompt on a later attempt.
	for ( let attempt = 0; ; attempt++ ) {
		try {
			const response = await fetch( endpoint, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${ authToken }`,
					'x-wpcom-ai-feature': IMAGE_FEATURE_SLUG,
					'content-type': 'application/json',
				},
				body,
			} );
			const raw = await response.text();
			return { ok: true, bytes: interpretImageResponse( raw, response.status ) };
		} catch ( error ) {
			const transient =
				error instanceof TransientImageError ||
				error instanceof ImageFilteredError ||
				// fetch network failures (DNS, reset, timeout) surface as TypeError.
				error instanceof TypeError;
			if ( transient && attempt < RETRY_DELAYS_SECONDS.length ) {
				await sleep( RETRY_DELAYS_SECONDS[ attempt ] );
				continue;
			}
			return {
				ok: false,
				error: error instanceof Error ? error.message : String( error ),
				...( error instanceof ImageFilteredError ? { filtered: true } : {} ),
			};
		}
	}
}

/**
 * Generate a batch of images concurrently (bounded pool). Results are keyed by
 * the same index as the requests; a failure never aborts the rest.
 */
export async function generateImages(
	requests: GenerateImageRequest[],
	onResult?: ( index: number, result: GenerateImageResult ) => void
): Promise< GenerateImageResult[] > {
	const endpoint = getImageEndpoint();
	const authToken = await resolveImageAuthToken();
	const results: GenerateImageResult[] = new Array( requests.length );
	let next = 0;

	const worker = async () => {
		while ( next < requests.length ) {
			const index = next++;
			const result = await generateOne( endpoint, authToken, requests[ index ] );
			results[ index ] = result;
			onResult?.( index, result );
		}
	};
	await Promise.all(
		Array.from( { length: Math.min( MAX_CONCURRENT_REQUESTS, requests.length ) }, worker )
	);
	return results;
}
