import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { resizeImage } from '@earendil-works/pi-coding-agent';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { Type } from 'typebox';
import { getWpcomAiGatewayBaseUrl } from 'cli/ai/providers';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { emitProgress } from 'cli/logger';
import { defineTool } from './define-tool';

const IMAGE_MODEL = 'gpt-image-2';
// gpt-image-2 rejects `background: "transparent"` (verified against the proxy
// July 2026); transparency requests fall back to the older model.
const TRANSPARENT_IMAGE_MODEL = 'gpt-image-1';
const REQUEST_TIMEOUT_MS = 180_000;
// Keep the model-facing preview small; the full-resolution file is on disk.
const PREVIEW_MAX_DIMENSION = 768;
const PREVIEW_MAX_BYTES = 300 * 1024;

const OUTPUT_FORMATS = {
	'.png': 'png',
	'.jpg': 'jpeg',
	'.jpeg': 'jpeg',
	'.webp': 'webp',
} as const;

const IMAGE_SIZE_VALUES = [ '1024x1024', '1536x1024', '1024x1536', 'auto' ] as const;
const IMAGE_QUALITY_VALUES = [ 'low', 'medium', 'high' ] as const;

function resolveOutputPath( outputPath: string ): { absolutePath: string; format: string } {
	if ( path.isAbsolute( outputPath ) ) {
		throw new Error(
			'outputPath must be a relative path under the Studio sites root, e.g. "my-site/wp-content/uploads/hero.png".'
		);
	}
	const absolutePath = path.resolve( STUDIO_SITES_ROOT, outputPath );
	const relativePath = path.relative( STUDIO_SITES_ROOT, absolutePath );
	if ( ! relativePath || relativePath.startsWith( '..' ) ) {
		throw new Error( 'outputPath must stay within the Studio sites root.' );
	}
	const extension = path.extname( absolutePath ).toLowerCase();
	const format = OUTPUT_FORMATS[ extension as keyof typeof OUTPUT_FORMATS ];
	if ( ! format ) {
		throw new Error( 'outputPath must end in .png, .jpg, .jpeg, or .webp.' );
	}
	return { absolutePath, format };
}

async function resolveWpcomAccessToken(): Promise< string > {
	const inlineToken = process.env.STUDIO_WPCOM_TOKEN?.trim();
	const accessToken = inlineToken || ( await readAuthToken() )?.accessToken;
	if ( ! accessToken ) {
		throw new Error(
			'Image generation uses the WordPress.com provider. Use /login to authenticate.'
		);
	}
	return accessToken;
}

async function requestImageGeneration(
	accessToken: string,
	body: Record< string, unknown >
): Promise< Buffer > {
	const baseUrl = getWpcomAiGatewayBaseUrl().replace( /\/+$/, '' );
	const response = await fetch( `${ baseUrl }/v1/images/generations`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${ accessToken }`,
			'Content-Type': 'application/json',
			'X-WPCOM-AI-Feature': 'studio-assistant',
			// The wpcom AI proxy only authorizes studio-assistant requests whose
			// User-Agent matches the OpenAI SDK's prefix.
			'User-Agent': 'OpenAI/JS studio-cli',
		},
		body: JSON.stringify( body ),
		signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
	} );

	const payload = ( await response.json().catch( () => null ) ) as {
		message?: string;
		error?: { message?: string };
		data?: Array< { b64_json?: string } >;
	} | null;

	if ( ! response.ok ) {
		// The wpcom proxy caps upstream requests at ~120 seconds; slow renders
		// surface as gateway errors, not OpenAI errors.
		if ( response.status === 504 || response.status === 502 ) {
			throw new Error(
				"Image generation exceeded the WordPress.com gateway's ~2 minute limit. " +
					'High-quality renders regularly hit this — retry with quality "medium" (do not retry "high", it will time out again).'
			);
		}
		const message = payload?.error?.message ?? payload?.message ?? response.statusText;
		throw new Error( `Image generation request failed (HTTP ${ response.status }): ${ message }` );
	}

	const base64 = payload?.data?.[ 0 ]?.b64_json;
	if ( ! base64 ) {
		throw new Error( 'Image generation response contained no image data.' );
	}
	return Buffer.from( base64, 'base64' );
}

export const generateImageTool = defineTool(
	'generate_image',
	'Generates an image from a text prompt and saves it into a site directory. ' +
		'Use this for site imagery the user asks for or the design needs: hero images, illustrations, logos, ornaments, textures, product photos. ' +
		'Write specific, visual prompts (subject, style, composition, palette, lighting); include "transparent background" use cases via the transparentBackground flag instead of prompt text. ' +
		'The file format follows the outputPath extension (.png, .jpg, .webp); transparent backgrounds require .png or .webp. ' +
		'Generation costs real quota — default medium quality is right for most site imagery; use low for small ornaments and drafts. ' +
		'Quality "high" regularly exceeds the WordPress.com gateway\'s ~2 minute limit and fails with a timeout, especially at non-square sizes — only use it when the user explicitly asks, and fall back to medium on a timeout instead of retrying high. ' +
		'The generated image is automatically shown to the user in the chat, and the result includes a preview so you can judge whether it fits. ' +
		'Do NOT present the image again with studio_present and do NOT repeat the file path in your reply — the user already sees the image card. Mention where it lives only in site-relative terms, and only when relevant. ' +
		'After saving, reference the file from the site (e.g. theme assets or import into the media library with wp_cli media import).',
	{
		prompt: Type.String( {
			description:
				'Detailed description of the image to generate: subject, style, composition, colors, lighting.',
		} ),
		outputPath: Type.String( {
			description:
				'Where to save the image, relative to the Studio sites root — e.g. "my-site/wp-content/uploads/ai/hero.png". Parent directories are created automatically. The extension selects the format.',
		} ),
		size: Type.Optional(
			Type.Enum( [ ...IMAGE_SIZE_VALUES ], {
				description:
					'Image dimensions: "1024x1024" (square), "1536x1024" (landscape), "1024x1536" (portrait), or "auto" to let the model choose. Defaults to auto.',
			} )
		),
		quality: Type.Optional(
			Type.Enum( [ ...IMAGE_QUALITY_VALUES ], {
				description: 'Rendering quality. Higher quality costs more. Defaults to medium.',
			} )
		),
		transparentBackground: Type.Optional(
			Type.Boolean( {
				description:
					'Generate with a transparent background (logos, ornaments, cut-out subjects). Requires a .png or .webp outputPath.',
			} )
		),
	},
	async ( args ) => {
		const { absolutePath, format } = resolveOutputPath( args.outputPath );
		if ( args.transparentBackground && format === 'jpeg' ) {
			throw new Error( 'Transparent backgrounds require a .png or .webp outputPath.' );
		}
		const accessToken = await resolveWpcomAccessToken();

		emitProgress( `Generating image (${ args.quality ?? 'medium' } quality)…` );
		const imageBuffer = await requestImageGeneration( accessToken, {
			model: args.transparentBackground ? TRANSPARENT_IMAGE_MODEL : IMAGE_MODEL,
			prompt: args.prompt,
			size: args.size ?? 'auto',
			quality: args.quality ?? 'medium',
			output_format: format,
			...( args.transparentBackground ? { background: 'transparent' } : {} ),
		} );

		await mkdir( path.dirname( absolutePath ), { recursive: true } );
		await writeFile( absolutePath, imageBuffer );

		const mimeType = format === 'png' ? 'image/png' : `image/${ format }`;
		const preview = await resizeImage( imageBuffer, mimeType, {
			maxWidth: PREVIEW_MAX_DIMENSION,
			maxHeight: PREVIEW_MAX_DIMENSION,
			maxBytes: PREVIEW_MAX_BYTES,
		} );

		const relativePath = path.relative( STUDIO_SITES_ROOT, absolutePath );
		const dimensions = preview ? ` (${ preview.originalWidth }x${ preview.originalHeight })` : '';
		const sizeKb = Math.round( imageBuffer.byteLength / 1024 );
		emitProgress( `Image saved to ${ relativePath }` );

		return {
			content: [
				{
					type: 'text' as const,
					text: `Image generated and saved to ${ relativePath }${ dimensions }, ${ sizeKb } KB.`,
				},
				{
					type: 'image' as const,
					data: preview?.data ?? imageBuffer.toString( 'base64' ),
					mimeType: preview?.mimeType ?? mimeType,
				},
			],
			studioArtifacts: [
				{
					type: 'media',
					widgetProps: {
						url: pathToFileURL( absolutePath ).href,
						mediaKind: 'image',
						alt: args.prompt,
						mediaId: null,
						source: {
							type: 'local',
							path: absolutePath,
							name: path.basename( absolutePath ),
							mimeType,
						},
					},
				},
			],
		};
	}
);
