import { readAuthToken } from '@studio/common/lib/shared-config';
import { getStudioUserAgent, getWpcomAiGatewayBaseUrl } from 'cli/ai/providers';

/**
 * AI image generation through the WP.com AI proxy's OpenAI-compatible images
 * route.
 *
 * A TypeScript port of minimalistic-site-builder's image subsystem
 * (GeminiImage / WpcomImageClient / ImagePromptComposer), trimmed for an
 * agentic host: the agent authors each image spec at call time following the
 * `imagery` skill's rules, so the builder's deterministic prompt-sanitization
 * machinery (grade-token stripping, pictorial page-context recasting) is
 * replaced by authoring guidance, and its LLM prompt-repair pass is replaced by
 * reporting safety-filtered failures back to the agent to rewrite and retry.
 * The route only delivers PNG.
 */

// The proxy picks the actual model behind the `image` alias; a real model id
// is rejected.
const IMAGE_MODEL_ALIAS = 'image';
// The proxy accepts only `low` or `medium`.
const IMAGE_QUALITY = 'medium';
// Studio's image slug on the proxy; it accepts regular user OAuth tokens.
const IMAGE_FEATURE_SLUG = 'studio-image';
const MAX_CONCURRENT_REQUESTS = 5;
const RETRY_DELAYS_SECONDS = [ 2, 5, 12 ];
// Prompt budget inherited from the builder: the model accepts longer prompts,
// but a tight prompt keeps the subject dominant instead of drowning it in context.
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

// The route renders only these three canvases, so each slot shape maps to the
// nearest one and CSS crops to the slot.
const IMAGE_SIZE_BY_KEYWORD = {
	square: '1024x1024',
	landscape: '1536x1024',
	ultrawide: '1536x1024',
	portrait: '1024x1536',
	'card-landscape': '1536x1024',
	'card-portrait': '1024x1536',
} as const;
export const IMAGE_ASPECT_RATIOS = Object.keys(
	IMAGE_SIZE_BY_KEYWORD
) as ImageAspectRatioKeyword[];
export type ImageAspectRatioKeyword = keyof typeof IMAGE_SIZE_BY_KEYWORD;

// Error codes the proxy passes through when the moderation system rejected the
// prompt; any other failure must not be reported as repairable-by-rewriting.
const FILTERED_ERROR_CODES = new Set( [ 'moderation_blocked', 'content_policy_violation' ] );

/**
 * Whether the generate_images capability is enabled for this session: an
 * explicit token, or a valid WP.com login (the proxy's `studio-image` slug
 * accepts user OAuth tokens). Sessions with neither — e.g. BYO Anthropic key
 * without a WP.com login — get no tool and no imagery prompt sections.
 */
export async function isImageGenerationAvailable(): Promise< boolean > {
	if ( process.env.STUDIO_IMAGE_API_TOKEN?.trim() ) {
		return true;
	}
	return ( await readAuthToken() ) !== null;
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

function getImageEndpoint(): string {
	const base = getWpcomAiGatewayBaseUrl().replace( /\/+$/, '' );
	return `${ base }/v1/images/generations`;
}

export function resolveImageSize( keyword: string | undefined ): string {
	return (
		IMAGE_SIZE_BY_KEYWORD[ ( keyword ?? 'landscape' ) as ImageAspectRatioKeyword ] ?? '1536x1024'
	);
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
	// No `stream` and no `n` above 1: the proxy rejects both.
	return {
		model: IMAGE_MODEL_ALIAS,
		prompt,
		quality: IMAGE_QUALITY,
		size: resolveImageSize( aspectRatioKeyword ),
	};
}

export class TransientImageError extends Error {}
export class ImageFilteredError extends Error {}

interface ImagesResponse {
	data?: Array< { b64_json?: string } >;
	error?: { code?: string; message?: string };
}

function parseJson( raw: string ): ImagesResponse | null {
	try {
		return JSON.parse( raw ) as ImagesResponse;
	} catch {
		return null;
	}
}

const PNG_SIGNATURE = Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] );

/**
 * Interpret a completed transfer: HTTP-status classification plus images
 * response parsing. Returns decoded PNG bytes or throws TransientImageError
 * (429/5xx — retryable), ImageFilteredError (moderation — retryable, and
 * repairable by rewriting the subject), or Error (permanent).
 */
export function interpretImageResponse( raw: string, status: number ): Buffer {
	if ( status === 429 || status >= 500 ) {
		throw new TransientImageError( `HTTP ${ status }: ${ raw.slice( 0, 300 ) }` );
	}
	const data = parseJson( raw );
	const errorCode = data?.error?.code;
	if ( errorCode && FILTERED_ERROR_CODES.has( errorCode ) ) {
		throw new ImageFilteredError(
			`Image safety filter rejected the prompt: ${ data?.error?.message ?? errorCode }`
		);
	}
	if ( status < 200 || status >= 300 ) {
		throw new Error( `Image proxy HTTP ${ status }: ${ raw.slice( 0, 500 ) }` );
	}
	if ( ! data ) {
		throw new Error( `Image proxy returned non-JSON response: ${ raw.slice( 0, 300 ) }` );
	}

	const base64 = data.data?.[ 0 ]?.b64_json;
	if ( ! base64 ) {
		throw new Error( `Image proxy response had no image data: ${ raw.slice( 0, 300 ) }` );
	}

	const bytes = Buffer.from( base64, 'base64' );
	// Byte magic is the source of truth: never deliver non-PNG bytes under a
	// .png filename.
	if ( ! bytes.subarray( 0, PNG_SIGNATURE.length ).equals( PNG_SIGNATURE ) ) {
		throw new Error( 'Image proxy returned bytes that are not a PNG' );
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
					'user-agent': getStudioUserAgent(),
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
