import { STUDIO_CHAT_MAX_IMAGE_PREVIEW_BYTES } from './chat-images';
import type { StudioChatImageMimeType } from './chat-images';

// Browser-only helpers (Image, canvas) for producing the downscaled
// `previewDataUrl` thumbnail persisted on user-prompt entries. Shared by the
// renderer composers; the CLI never imports the DOM at runtime because both
// helpers keep all DOM access inside their function bodies.

const PREVIEW_MAX_DIMENSION_PX = 256;
const PREVIEW_JPEG_QUALITY = 0.8;

export function loadImageElement( src: string ): Promise< HTMLImageElement | undefined > {
	return new Promise( ( resolve ) => {
		const image = new Image();
		image.onload = () => resolve( image );
		image.onerror = () => resolve( undefined );
		image.src = src;
	} );
}

// Downscales the attached image into a small thumbnail for transcript chips.
// The thumbnail is what gets persisted on the display entry — the full bytes
// only live in the model's message — so it must stay genuinely small.
export function createStudioChatImagePreview(
	image: HTMLImageElement,
	mimeType: StudioChatImageMimeType
): string | undefined {
	const scale = Math.min(
		1,
		PREVIEW_MAX_DIMENSION_PX / Math.max( image.naturalWidth, image.naturalHeight, 1 )
	);
	const width = Math.max( 1, Math.round( image.naturalWidth * scale ) );
	const height = Math.max( 1, Math.round( image.naturalHeight * scale ) );
	const canvas = document.createElement( 'canvas' );
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext( '2d' );
	if ( ! context ) {
		return undefined;
	}
	context.drawImage( image, 0, 0, width, height );
	try {
		// JPEG drops the alpha channel, so only JPEG sources re-encode as JPEG.
		const previewDataUrl =
			mimeType === 'image/jpeg'
				? canvas.toDataURL( 'image/jpeg', PREVIEW_JPEG_QUALITY )
				: canvas.toDataURL( 'image/png' );
		return previewDataUrl.length <= STUDIO_CHAT_MAX_IMAGE_PREVIEW_BYTES
			? previewDataUrl
			: undefined;
	} catch {
		return undefined;
	}
}
