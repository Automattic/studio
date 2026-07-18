import type { StudioChatFileAttachment } from './chat-files';
import type { AiModelFamily } from './models';

// Image types the model accepts as multimodal content blocks (matches the
// Anthropic vision-supported set). Anything else is sent as a file path instead.
export const STUDIO_CHAT_IMAGE_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
] as const;

export type StudioChatImageMimeType = ( typeof STUDIO_CHAT_IMAGE_MIME_TYPES )[ number ];

export interface StudioChatImageAttachment {
	id: string;
	name: string;
	mimeType: StudioChatImageMimeType;
	size: number;
	width?: number;
	height?: number;
}

export interface StudioChatImage extends StudioChatImageAttachment {
	dataBase64: string;
}

export interface StudioAiSessionInputPayload {
	prompt: string;
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
}

export interface StudioChatImageLimits {
	/** Maximum image content blocks per message. */
	maxImages: number;
	/** Per-image ceiling, measured against the base64 payload the API sees. */
	maxImageEncodedBytes: number;
	/** Per-message ceiling across all images, base64-encoded. */
	maxTotalImageEncodedBytes: number;
}

// Providers don't expose these limits programmatically — every client hardcodes
// them from the docs, keyed here by model family.
//
// Anthropic caps each image at 5 MB of *base64* on Bedrock/Vertex-style
// deployments (10 MB on the direct API — the wpcom proxy's upstream is
// unconfirmed, so assume the stricter one) and applies a ~2000px per-side rule
// to requests with many image blocks. OpenAI states no per-image cap and allows
// payloads far larger than we can ever send.
//
// Both families route through the wpcom AI proxy by default, whose nginx front
// rejects request bodies over 20 MiB (measured empirically, July 2026) — that,
// not the providers' request caps, bounds the totals. 16 MB leaves headroom for
// the prompt, history, and tool JSON. Old sessions resend only their newest
// image-bearing turn (see the pi runtime's strip-stale-images), so these are
// per-message budgets, not per-session.
export const STUDIO_CHAT_IMAGE_LIMITS_BY_FAMILY: Record< AiModelFamily, StudioChatImageLimits > = {
	anthropic: {
		maxImages: 20,
		maxImageEncodedBytes: Math.floor( 4.75 * 1024 * 1024 ),
		maxTotalImageEncodedBytes: 16 * 1024 * 1024,
	},
	openai: {
		maxImages: 40,
		maxImageEncodedBytes: 16 * 1024 * 1024,
		maxTotalImageEncodedBytes: 16 * 1024 * 1024,
	},
};

function combineStudioChatImageLimits(
	pick: ( a: number, b: number ) => number
): StudioChatImageLimits {
	return Object.values( STUDIO_CHAT_IMAGE_LIMITS_BY_FAMILY ).reduce( ( a, b ) => ( {
		maxImages: pick( a.maxImages, b.maxImages ),
		maxImageEncodedBytes: pick( a.maxImageEncodedBytes, b.maxImageEncodedBytes ),
		maxTotalImageEncodedBytes: pick( a.maxTotalImageEncodedBytes, b.maxTotalImageEncodedBytes ),
	} ) );
}

/**
 * Limits for the given model family. Without a family, returns the strictest
 * value on each axis, so images accepted under it remain valid after a model
 * (or family) switch.
 */
export function getStudioChatImageLimits( family?: AiModelFamily ): StudioChatImageLimits {
	if ( family ) {
		return STUDIO_CHAT_IMAGE_LIMITS_BY_FAMILY[ family ];
	}
	return combineStudioChatImageLimits( Math.min );
}

/**
 * The loosest value on each axis — the backstop used by model-blind validation
 * (IPC, CLI payloads). The composer enforces the family-precise limits.
 */
export function getLoosestStudioChatImageLimits(): StudioChatImageLimits {
	return combineStudioChatImageLimits( Math.max );
}

// Resize target for oversized attachments (see image-fit.ts). Dimension covers
// Anthropic's many-image ~2000px rule; both providers downscale server-side to
// ~1568-2576px anyway, so nothing is lost. The byte target sits below the
// strictest per-image cap so fitted output never grazes the boundary.
export const STUDIO_CHAT_IMAGE_FIT_MAX_DIMENSION = 2000;
export const STUDIO_CHAT_IMAGE_FIT_MAX_ENCODED_BYTES = Math.floor( 4.5 * 1024 * 1024 );

/** Base64 size on the wire for a binary payload of `binaryBytes`. */
export function getStudioChatImageEncodedBytes( binaryBytes: number ): number {
	return Math.ceil( binaryBytes / 3 ) * 4;
}

export function toStudioChatImageAttachment( image: StudioChatImage ): StudioChatImageAttachment {
	const { dataBase64: _dataBase64, ...attachment } = image;
	return attachment;
}

// Renderer CSP allows `data:` images but not `blob:`, so previews use data URLs.
export function toImageDataUrl( mimeType: string, dataBase64: string ): string {
	return `data:${ mimeType };base64,${ dataBase64 }`;
}

export function isStudioChatImageMimeType( value: string ): value is StudioChatImageMimeType {
	return ( STUDIO_CHAT_IMAGE_MIME_TYPES as readonly string[] ).includes( value );
}

/**
 * Model-blind backstop validation for image payloads arriving over IPC or the
 * CLI input file. Checks against the loosest family limits — the composer is
 * the layer that enforces the family-precise ones.
 */
export function validateStudioChatImages(
	images: StudioChatImage[] | undefined
): StudioChatImage[] {
	if ( ! images || images.length === 0 ) {
		return [];
	}

	const limits = getLoosestStudioChatImageLimits();
	if ( images.length > limits.maxImages ) {
		throw new Error( `You can attach up to ${ limits.maxImages } images.` );
	}

	let totalEncodedBytes = 0;
	for ( const image of images ) {
		if ( ! isStudioChatImageMimeType( image.mimeType ) ) {
			throw new Error( 'Only PNG, JPEG, GIF, and WebP images can be attached.' );
		}

		if ( typeof image.dataBase64 !== 'string' || ! image.dataBase64 ) {
			throw new Error( 'Attached image data is missing.' );
		}

		const encodedBytes = Math.max(
			image.dataBase64.length,
			getStudioChatImageEncodedBytes( image.size )
		);
		if ( encodedBytes > limits.maxImageEncodedBytes ) {
			throw new Error(
				`Attached images must be ${ Math.floor(
					limits.maxImageEncodedBytes / ( 1024 * 1024 )
				) } MB or smaller.`
			);
		}

		totalEncodedBytes += encodedBytes;
		if ( totalEncodedBytes > limits.maxTotalImageEncodedBytes ) {
			throw new Error( 'Attached images are too large to send together.' );
		}
	}

	return images;
}
