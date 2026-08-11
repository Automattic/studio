/**
 * Capture plumbing shared by the clip flows: converting the IPC handler's
 * `LocalMediaFile` payloads and cropping viewport captures down to a clip's
 * rect (element bounds, marquee region, or loupe lens).
 */

import type { LocalMediaFile } from '@/data/core';
import type { ClipViewportRect } from '@studio/common/inspector/protocol';

export function localMediaFileToFile( file: LocalMediaFile ): File {
	return new File( [ file.data ], file.name, { type: file.mimeType } );
}

// Loupe backdrops travel into the guest page via `executeJavaScript`, which
// only carries strings — so the capture becomes a data URL. Chunked to keep
// the argument list under the call-stack limit.
export function localMediaFileToDataUrl( file: LocalMediaFile ): string {
	const bytes = new Uint8Array( file.data );
	const chunkSize = 0x8000;
	let binary = '';
	for ( let i = 0; i < bytes.length; i += chunkSize ) {
		binary += String.fromCharCode( ...bytes.subarray( i, i + chunkSize ) );
	}
	return `data:${ file.mimeType };base64,${ btoa( binary ) }`;
}

export const isFiniteNumber = ( value: unknown ): value is number =>
	typeof value === 'number' && Number.isFinite( value );

// Longest side any clip image may have when it reaches the composer. The
// Anthropic API hard-rejects images over 8000px in either dimension (a 400
// that poisons the whole conversation, since history re-sends attachments),
// and anything past ~1568px gets downscaled server-side anyway — extra
// pixels are pure upload cost.
export const MAX_CLIP_IMAGE_DIMENSION = 2000;

/**
 * Downscales an image file so its longest side fits `maxDimension`,
 * re-encoding as JPEG. Returns the original file when it already fits.
 */
export async function fitImageFileWithinLimit(
	file: File,
	maxDimension: number = MAX_CLIP_IMAGE_DIMENSION
): Promise< File > {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap( file );
	} catch {
		// Undecodable image (or no createImageBitmap, e.g. tests): pass the
		// original through rather than dropping the clip.
		return file;
	}
	try {
		const scale = maxDimension / Math.max( bitmap.width, bitmap.height );
		if ( scale >= 1 ) {
			return file;
		}
		const canvas = document.createElement( 'canvas' );
		canvas.width = Math.max( 1, Math.round( bitmap.width * scale ) );
		canvas.height = Math.max( 1, Math.round( bitmap.height * scale ) );
		const context = canvas.getContext( '2d' );
		if ( ! context ) {
			return file;
		}
		context.drawImage( bitmap, 0, 0, canvas.width, canvas.height );
		const blob = await new Promise< Blob | null >( ( resolve ) =>
			canvas.toBlob( resolve, 'image/jpeg', 0.85 )
		);
		if ( ! blob ) {
			return file;
		}
		return new File( [ blob ], file.name, { type: 'image/jpeg' } );
	} finally {
		bitmap.close();
	}
}

// Rects come from the (untrusted) guest page over the console bridge; only
// clean numeric rects are acted on.
export function sanitizeViewportRect( rect: unknown ): ClipViewportRect | null {
	if ( ! rect || typeof rect !== 'object' ) {
		return null;
	}
	const { x, y, width, height } = rect as Record< string, unknown >;
	if ( ! [ x, y, width, height ].every( isFiniteNumber ) ) {
		return null;
	}
	if (
		( x as number ) < 0 ||
		( y as number ) < 0 ||
		( width as number ) <= 0 ||
		( height as number ) <= 0
	) {
		return null;
	}
	return { x: x as number, y: y as number, width: width as number, height: height as number };
}

/**
 * Crops a rect (viewport-relative CSS px) out of a native-resolution
 * viewport capture. The capture's device-pixel ratio is derived from its
 * width vs the webview's CSS width, so the crop stays aligned on any
 * display.
 */
export async function cropViewportCapture(
	capture: LocalMediaFile,
	rect: ClipViewportRect,
	viewportCssWidth: number,
	fileName: string
): Promise< File | null > {
	const bitmap = await createImageBitmap(
		new Blob( [ capture.data ], { type: capture.mimeType } )
	);
	try {
		if ( viewportCssWidth <= 0 ) return null;
		const ratio = bitmap.width / viewportCssWidth;
		const sx = Math.max( 0, Math.min( bitmap.width, rect.x * ratio ) );
		const sy = Math.max( 0, Math.min( bitmap.height, rect.y * ratio ) );
		const sw = Math.min( bitmap.width - sx, rect.width * ratio );
		const sh = Math.min( bitmap.height - sy, rect.height * ratio );
		if ( sw < 1 || sh < 1 ) return null;
		// Keep crops within the attachment dimension budget as they render.
		const fit = Math.min( 1, MAX_CLIP_IMAGE_DIMENSION / Math.max( sw, sh ) );
		const canvas = document.createElement( 'canvas' );
		canvas.width = Math.max( 1, Math.round( sw * fit ) );
		canvas.height = Math.max( 1, Math.round( sh * fit ) );
		const context = canvas.getContext( '2d' );
		if ( ! context ) return null;
		context.drawImage( bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height );
		const blob = await new Promise< Blob | null >( ( resolve ) =>
			canvas.toBlob( resolve, 'image/jpeg', 0.9 )
		);
		if ( ! blob ) return null;
		return new File( [ blob ], fileName, { type: 'image/jpeg' } );
	} finally {
		bitmap.close();
	}
}

/** Pads an element's bounding box a little and clamps it to the viewport,
 * so element-clip crops keep a hint of surrounding context. */
export function padRectWithinViewport(
	rect: ClipViewportRect,
	padding: number,
	viewport: { width: number; height: number }
): ClipViewportRect | null {
	const x = Math.max( 0, rect.x - padding );
	const y = Math.max( 0, rect.y - padding );
	const width = Math.min( viewport.width - x, rect.width + padding * 2 );
	const height = Math.min( viewport.height - y, rect.height + padding * 2 );
	if ( width <= 0 || height <= 0 ) {
		return null;
	}
	return { x, y, width, height };
}
