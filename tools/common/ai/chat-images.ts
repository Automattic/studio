import type { StudioChatFileAttachment } from './chat-files';

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
	// Downscaled `data:` URL thumbnail for transcript chips. Never sent to the
	// model — the full bytes ride separately as `dataBase64`. Generated where a
	// canvas is available (the renderer composer); absent otherwise.
	previewDataUrl?: string;
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

export const STUDIO_CHAT_MAX_IMAGES = 4;
export const STUDIO_CHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
export const STUDIO_CHAT_MAX_IMAGE_DIMENSION_PX = 8000;
// Hard cap on the thumbnail data URL so a full-size image can't masquerade as
// a "preview" and double the transcript's on-disk size.
export const STUDIO_CHAT_MAX_IMAGE_PREVIEW_BYTES = 256 * 1024;

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

export function getStudioChatImageDecodedBytes( dataBase64: string ): number {
	const normalized = dataBase64.replace( /\s/g, '' );
	const padding = normalized.endsWith( '==' ) ? 2 : normalized.endsWith( '=' ) ? 1 : 0;
	return Math.max( 0, Math.floor( ( normalized.length * 3 ) / 4 ) - padding );
}

function assertValidImageDimension( value: unknown ): number | undefined {
	if ( value === undefined ) {
		return undefined;
	}
	if ( typeof value !== 'number' || ! Number.isFinite( value ) ) {
		throw new Error( 'Attached image dimensions must be finite numbers.' );
	}
	return value;
}

export function validateStudioChatImages(
	images: StudioChatImage[] | undefined
): StudioChatImage[] {
	if ( ! images || images.length === 0 ) {
		return [];
	}

	if ( images.length > STUDIO_CHAT_MAX_IMAGES ) {
		throw new Error( `You can attach up to ${ STUDIO_CHAT_MAX_IMAGES } images.` );
	}

	let totalBytes = 0;
	for ( const image of images ) {
		if ( ! isStudioChatImageMimeType( image.mimeType ) ) {
			throw new Error( 'Only PNG, JPEG, GIF, and WebP images can be attached.' );
		}

		if ( typeof image.dataBase64 !== 'string' || ! image.dataBase64 ) {
			throw new Error( 'Attached image data is missing.' );
		}

		const decodedBytes = getStudioChatImageDecodedBytes( image.dataBase64 );
		const size = image.size > 0 ? image.size : decodedBytes;
		if ( size > STUDIO_CHAT_MAX_IMAGE_BYTES || decodedBytes > STUDIO_CHAT_MAX_IMAGE_BYTES ) {
			throw new Error( 'Attached images must be 5 MB or smaller.' );
		}

		totalBytes += Math.max( size, decodedBytes );
		if ( totalBytes > STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES ) {
			throw new Error( 'Attached images are too large to send together.' );
		}

		const width = assertValidImageDimension( image.width );
		const height = assertValidImageDimension( image.height );
		if (
			( width !== undefined && width > STUDIO_CHAT_MAX_IMAGE_DIMENSION_PX ) ||
			( height !== undefined && height > STUDIO_CHAT_MAX_IMAGE_DIMENSION_PX )
		) {
			throw new Error( 'Attached images must be 8000 pixels or smaller on each side.' );
		}

		if ( image.previewDataUrl !== undefined ) {
			if (
				typeof image.previewDataUrl !== 'string' ||
				! image.previewDataUrl.startsWith( 'data:image/' )
			) {
				throw new Error( 'Attached image previews must be data URLs.' );
			}
			if ( image.previewDataUrl.length > STUDIO_CHAT_MAX_IMAGE_PREVIEW_BYTES ) {
				throw new Error( 'Attached image previews must be 256 KB or smaller.' );
			}
		}
	}

	return images;
}
