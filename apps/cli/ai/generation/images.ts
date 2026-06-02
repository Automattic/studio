import { aspectFromHint, generateImageBytes, type ImageAspectRatio } from './wpcom-image';

/**
 * Resolves the `AI_IMAGE:` placeholder convention. Generated markup uses
 *   <img src="..." alt="AI_IMAGE: <description> | <style> | <aspect>">
 * so imagery can be filled in after structure is generated. These helpers find
 * those placeholders, generate the image, hand the bytes to a caller-supplied
 * persistence strategy (theme assets dir, or the media uploads dir), and
 * rewrite the tag's `src`/`alt` in place.
 */

export interface AiImageMatch {
	tag: string;
	description: string;
	style?: string;
	aspect?: string;
}

const IMG_TAG_RE = /<img\b[^>]*>/gi;

export function getAttr( tag: string, name: string ): string | undefined {
	const match =
		tag.match( new RegExp( `\\b${ name }\\s*=\\s*"([^"]*)"`, 'i' ) ) ??
		tag.match( new RegExp( `\\b${ name }\\s*=\\s*'([^']*)'`, 'i' ) );
	return match ? match[ 1 ] : undefined;
}

function setAttr( tag: string, name: string, value: string ): string {
	const escaped = value.replace( /&/g, '&amp;' ).replace( /"/g, '&quot;' );
	const re = new RegExp( `\\s${ name }\\s*=\\s*("[^"]*"|'[^']*')`, 'i' );
	if ( re.test( tag ) ) {
		return tag.replace( re, ` ${ name }="${ escaped }"` );
	}
	return tag.replace( /(\s*\/?>)\s*$/, ` ${ name }="${ escaped }"$1` );
}

export function parseAiImageAlt(
	alt: string
): { description: string; style?: string; aspect?: string } | null {
	const match = alt.match( /^\s*AI_IMAGE:\s*(.+)$/i );
	if ( ! match ) {
		return null;
	}
	const parts = match[ 1 ].split( '|' ).map( ( s ) => s.trim() );
	return {
		description: parts[ 0 ] || 'abstract textured background',
		style: parts[ 1 ],
		aspect: parts[ 2 ],
	};
}

export function findAiImages( html: string ): AiImageMatch[] {
	const out: AiImageMatch[] = [];
	for ( const tag of html.match( IMG_TAG_RE ) ?? [] ) {
		const alt = getAttr( tag, 'alt' );
		if ( ! alt ) {
			continue;
		}
		const parsed = parseAiImageAlt( alt );
		if ( parsed ) {
			out.push( { tag, ...parsed } );
		}
	}
	return out;
}

// Removes AI_IMAGE placeholder <img> tags (used when imagery can't be
// generated) while leaving real <img> tags intact, so a page renders as
// intentional sections rather than broken images.
export function stripAiImagePlaceholders( html: string ): string {
	return html.replace( /<img\b[^>]*\bAI_IMAGE:[^>]*>/gi, '' );
}

export function buildImagePrompt( description: string, style?: string ): string {
	const styleClause = style ? ` Style: ${ style }.` : '';
	return `${ description }.${ styleClause } High quality, professional, clean composition. No text, no lettering, no watermark, no logo.`;
}

export interface PersistImageContext {
	description: string;
	aspect: ImageAspectRatio;
	index: number;
}

export type PersistImage = ( bytes: Buffer, ctx: PersistImageContext ) => Promise< string | null >;

export interface ImageResolution {
	html: string;
	generated: number;
	failed: number;
	total: number;
}

/**
 * Best-effort: any image that fails to generate or persist is left as-is (the
 * placeholder stays) so a single failure never aborts the whole build.
 */
export async function resolveAiImagesInHtml(
	html: string,
	persist: PersistImage
): Promise< ImageResolution > {
	const matches = findAiImages( html );
	let out = html;
	let generated = 0;
	let failed = 0;
	let index = 0;

	for ( const match of matches ) {
		index++;
		try {
			const aspect = aspectFromHint( match.aspect );
			const bytes = await generateImageBytes(
				buildImagePrompt( match.description, match.style ),
				aspect
			);
			const url = await persist( bytes, { description: match.description, aspect, index } );
			if ( ! url ) {
				failed++;
				continue;
			}
			let newTag = setAttr( match.tag, 'src', url );
			newTag = setAttr( newTag, 'alt', match.description );
			out = out.replace( match.tag, newTag );
			generated++;
		} catch {
			failed++;
		}
	}

	return { html: out, generated, failed, total: matches.length };
}
