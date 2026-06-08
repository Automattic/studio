import { readAuthToken } from '@studio/common/lib/shared-config';
import { withTransientRetry } from './llm';

/**
 * AI image generation through the WordPress.com AI API proxy.
 *
 * Uses the OpenAI images endpoint (`/v1/images/generations`, model
 * `gpt-image-1`) under the `studio-assistant` feature slug — the same slug
 * Studio already uses for OpenAI text and which is authorized for logged-in
 * WordPress.com users. (Telex's `telex-theme-image` Imagen feature returns 403
 * for non-Telex accounts, so it can't be reused here.) Auth reuses the user's
 * WordPress.com OAuth token, so a logged-in user gets imagery with no extra
 * credentials.
 */

const DEFAULT_PROXY = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
const DEFAULT_IMAGE_FEATURE = 'studio-assistant';

export type ImageAspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

// gpt-image-1 only accepts a fixed set of sizes. Map our aspect ratios to the
// nearest supported size (square / landscape / portrait).
function sizeForAspect( aspect: ImageAspectRatio ): string {
	switch ( aspect ) {
		case '16:9':
		case '4:3':
			return '1536x1024';
		case '9:16':
		case '3:4':
			return '1024x1536';
		default:
			return '1024x1024';
	}
}

/**
 * Map a free-form hint (an AI_IMAGE aspect token like "16:9", a keyword like
 * "hero"/"portrait", or a "1792x1024" dimension string) to a supported aspect
 * ratio.
 */
export function aspectFromHint( hint?: string ): ImageAspectRatio {
	const h = ( hint ?? '' ).toLowerCase().trim();

	const dims = h.match( /(\d+)\s*[x×]\s*(\d+)/ );
	if ( dims ) {
		const ratio = Number( dims[ 1 ] ) / Number( dims[ 2 ] );
		if ( ratio > 1.6 ) {
			return '16:9';
		}
		if ( ratio > 1.2 ) {
			return '4:3';
		}
		if ( ratio < 0.6 ) {
			return '9:16';
		}
		if ( ratio < 0.85 ) {
			return '3:4';
		}
		return '1:1';
	}

	if ( /16\s*[:x]\s*9|wide|landscape|hero|banner|cover/.test( h ) ) {
		return '16:9';
	}
	if ( /4\s*[:x]\s*3/.test( h ) ) {
		return '4:3';
	}
	if ( /9\s*[:x]\s*16|tall/.test( h ) ) {
		return '9:16';
	}
	if ( /3\s*[:x]\s*4|portrait/.test( h ) ) {
		return '3:4';
	}
	if ( /1\s*[:x]\s*1|square|avatar|icon/.test( h ) ) {
		return '1:1';
	}
	return '16:9';
}

async function resolveWpcomToken(): Promise< string > {
	const inline = process.env.STUDIO_WPCOM_TOKEN?.trim();
	if ( inline ) {
		return inline;
	}
	const token = await readAuthToken();
	if ( ! token?.accessToken ) {
		throw new Error(
			'WordPress.com login required for AI image generation. Run `studio auth login`.'
		);
	}
	return token.accessToken;
}

interface OpenAiImageResponse {
	data?: Array< { b64_json?: string } >;
}

export async function generateImageBytes(
	prompt: string,
	aspectRatio: ImageAspectRatio = '16:9'
): Promise< Buffer > {
	const token = await resolveWpcomToken();
	const proxy = ( process.env.WPCOM_AI_PROXY_BASE_URL?.trim() || DEFAULT_PROXY ).replace(
		/\/+$/,
		''
	);
	const model = process.env.STUDIO_WSG_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
	const feature = process.env.STUDIO_WSG_IMAGE_FEATURE?.trim() || DEFAULT_IMAGE_FEATURE;
	const endpoint = `${ proxy }/v1/images/generations`;

	// Retry transient proxy hiccups (503/502/504/429). The thrown messages embed
	// the HTTP status so isTransientError classifies them correctly.
	const base64 = await withTransientRetry( async () => {
		const response = await fetch( endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${ token }`,
				'X-WPCOM-AI-Feature': feature,
				'content-type': 'application/json',
			},
			body: JSON.stringify( {
				model,
				prompt,
				n: 1,
				size: sizeForAspect( aspectRatio ),
			} ),
		} );

		if ( ! response.ok ) {
			const detail = await response.text().catch( () => '' );
			throw new Error(
				`WordPress.com image API request failed (HTTP ${ response.status }): ${ detail.slice(
					0,
					300
				) }`
			);
		}

		const data = ( await response.json() ) as OpenAiImageResponse;
		const encoded = data.data?.[ 0 ]?.b64_json;
		if ( ! encoded ) {
			throw new Error( 'WordPress.com image API returned no image data.' );
		}
		return encoded;
	} );

	return Buffer.from( base64, 'base64' );
}
