// The Anthropic API rejects images over 8000px in either dimension, and a
// rejected image attached to the session history poisons every subsequent
// turn. Downscale before attaching; 2000px keeps plenty of detail for the
// model while staying far below the hard limit.
export const MAX_CHAT_IMAGE_DIMENSION = 2000;

const JPEG_QUALITY = 0.9;

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

/**
 * Downscales an image so its longest side fits within `maxDimension`,
 * re-encoding to PNG (when the downscaled image has transparency) or JPEG.
 * Returns the original file unchanged when it already fits, when the input
 * can't be decoded, or when canvas APIs are unavailable — never throws.
 */
export async function fitImageFileWithinLimit(
	file: File,
	maxDimension: number = MAX_CHAT_IMAGE_DIMENSION
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
		if ( width <= maxDimension && height <= maxDimension ) {
			return file;
		}
		const scale = maxDimension / Math.max( width, height );
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
		const outputType = keepAlpha ? 'image/png' : 'image/jpeg';
		const blob = await canvasToBlob( canvas, outputType, JPEG_QUALITY );
		if ( ! blob ) {
			return file;
		}
		const mimeType = blob.type || outputType;
		return new File( [ blob ], withExtensionForMimeType( file.name, mimeType ), {
			type: mimeType,
			lastModified: file.lastModified,
		} );
	} catch {
		return file;
	} finally {
		bitmap.close();
	}
}
