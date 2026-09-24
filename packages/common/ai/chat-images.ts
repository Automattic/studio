import type { StudioChatFileAttachment } from './chat-files';
import type { StudioVisualAnnotationSummary } from './visual-annotations';

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
	visualAnnotations?: StudioVisualAnnotationSummary[];
}

export const STUDIO_CHAT_MAX_IMAGES = 4;
export const STUDIO_CHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const STUDIO_CHAT_MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;

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
	}

	return images;
}
