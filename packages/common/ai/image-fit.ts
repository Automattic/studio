import {
	STUDIO_CHAT_IMAGE_FIT_MAX_DIMENSION,
	STUDIO_CHAT_IMAGE_FIT_MAX_ENCODED_BYTES,
	getStudioChatImageEncodedBytes,
} from './chat-images';

export interface ImageFitTarget {
	/** Longest-side ceiling in pixels. */
	maxDimension: number;
	/** Encoded (base64) size ceiling for the output file. */
	maxEncodedBytes: number;
}

const DEFAULT_FIT_TARGET: ImageFitTarget = {
	maxDimension: STUDIO_CHAT_IMAGE_FIT_MAX_DIMENSION,
	maxEncodedBytes: STUDIO_CHAT_IMAGE_FIT_MAX_ENCODED_BYTES,
};

// PNG is attempted first for transparent sources; JPEG quality then walks down
// before dimensions shrink further, mirroring what other clients converged on.
const PNG_QUALITY = 0.92;
const JPEG_QUALITY_LADDER = [ 0.9, 0.8, 0.7, 0.6 ];
// Below this the image stops being legible to the model; give up and let the
// caller reject instead of sending a thumbnail.
const MIN_FIT_DIMENSION = 320;
const DIMENSION_STEP = 0.75;

const EXTENSION_BY_OUTPUT_MIME_TYPE: Record< string, string > = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
};

type FittableCanvas = HTMLCanvasElement | OffscreenCanvas;
type FittableCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createCanvas( width: number, height: number ): FittableCanvas | null {
	if ( typeof OffscreenCanvas === 'function' ) {
		return new OffscreenCanvas( width, height );
	}
	if ( typeof document !== 'undefined' ) {
		const canvas = document.createElement( 'canvas' );
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	return null;
}

function canvasToBlob(
	canvas: FittableCanvas,
	type: string,
	quality: number
): Promise< Blob | null > {
	if ( 'convertToBlob' in canvas ) {
		return canvas.convertToBlob( { type, quality } );
	}
	return new Promise( ( resolve ) => canvas.toBlob( resolve, type, quality ) );
}

function hasTransparency( context: FittableCanvasContext, width: number, height: number ): boolean {
	const { data } = context.getImageData( 0, 0, width, height );
	for ( let i = 3; i < data.length; i += 4 ) {
		if ( data[ i ] < 255 ) {
			return true;
		}
	}
	return false;
}

function withExtensionForMimeType( name: string, mimeType: string ): string {
	const extension = EXTENSION_BY_OUTPUT_MIME_TYPE[ mimeType ];
	if ( ! extension ) {
		return name;
	}
	const base = name.replace( /\.[^.]+$/, '' ) || name;
	return `${ base }.${ extension }`;
}

function fitsEncodedBudget( binaryBytes: number, target: ImageFitTarget ): boolean {
	return getStudioChatImageEncodedBytes( binaryBytes ) <= target.maxEncodedBytes;
}

/**
 * Fits an image within the attachment limits: downscales so the longest side
 * is within `maxDimension`, then re-encodes (PNG when the result needs
 * transparency, JPEG otherwise) walking quality and, as a last resort,
 * dimensions down until the encoded size fits `maxEncodedBytes`. Animated
 * inputs collapse to their first frame — providers only look at the first
 * frame anyway. Returns the original file unchanged when it already fits, and
 * also when the input can't be decoded or canvas APIs are unavailable (the
 * caller's size check then rejects oversized ones) — never throws.
 */
export async function fitImageFileWithinLimits(
	file: File,
	target: ImageFitTarget = DEFAULT_FIT_TARGET
): Promise< File > {
	if ( typeof createImageBitmap !== 'function' ) {
		return file;
	}
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap( file );
	} catch {
		return file;
	}
	try {
		const { width, height } = bitmap;
		if (
			width <= target.maxDimension &&
			height <= target.maxDimension &&
			fitsEncodedBudget( file.size, target )
		) {
			return file;
		}

		let scale = Math.min( 1, target.maxDimension / Math.max( width, height ) );
		while ( Math.round( Math.max( width, height ) * scale ) >= MIN_FIT_DIMENSION ) {
			const targetWidth = Math.max( 1, Math.round( width * scale ) );
			const targetHeight = Math.max( 1, Math.round( height * scale ) );
			const canvas = createCanvas( targetWidth, targetHeight );
			const context = canvas?.getContext( '2d' ) as FittableCanvasContext | null;
			if ( ! canvas || ! context ) {
				return file;
			}
			context.drawImage( bitmap, 0, 0, targetWidth, targetHeight );
			const keepAlpha =
				file.type !== 'image/jpeg' && hasTransparency( context, targetWidth, targetHeight );

			const candidates: Array< [ string, number ] > = keepAlpha
				? [ [ 'image/png', PNG_QUALITY ] ]
				: [];
			for ( const quality of JPEG_QUALITY_LADDER ) {
				candidates.push( [ 'image/jpeg', quality ] );
			}

			let flattened = false;
			for ( const [ outputType, quality ] of candidates ) {
				if ( outputType === 'image/jpeg' && keepAlpha && ! flattened ) {
					// JPEG has no alpha channel; matte on white instead of the
					// black the encoder would otherwise produce.
					context.globalCompositeOperation = 'destination-over';
					context.fillStyle = '#ffffff';
					context.fillRect( 0, 0, targetWidth, targetHeight );
					context.globalCompositeOperation = 'source-over';
					flattened = true;
				}
				const blob = await canvasToBlob( canvas, outputType, quality );
				if ( blob && fitsEncodedBudget( blob.size, target ) ) {
					const mimeType = blob.type || outputType;
					return new File( [ blob ], withExtensionForMimeType( file.name, mimeType ), {
						type: mimeType,
						lastModified: file.lastModified,
					} );
				}
			}
			scale *= DIMENSION_STEP;
		}
		return file;
	} catch {
		return file;
	} finally {
		bitmap.close();
	}
}
