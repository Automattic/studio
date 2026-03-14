/**
 * Screenshot comparison utilities.
 *
 * Provides pixel-level diffing between two PNG screenshots using pixelmatch.
 * Handles images of different heights by padding the shorter one.
 */

import { PNG } from 'pngjs';

interface DiffResult {
	/** The diff image as a PNG buffer — changed pixels highlighted in red. */
	diffPng: Buffer;
	/** Number of pixels that differ between the two images. */
	changedPixels: number;
	/** Total number of pixels compared. */
	totalPixels: number;
	/** Percentage of pixels that changed (0–100, two decimal places). */
	changePercent: number;
	/** Width of the compared images. */
	width: number;
	/** Height of the compared images (max of both). */
	height: number;
}

/**
 * Compare two PNG buffers and return a diff image + stats.
 *
 * If the images have different heights, the shorter one is padded with
 * transparent pixels so pixelmatch can compare them at the same dimensions.
 * Width differences are not supported — both images must have the same width.
 */
export async function diffScreenshots(
	beforePng: Buffer,
	afterPng: Buffer
): Promise< DiffResult > {
	const before = PNG.sync.read( beforePng );
	const after = PNG.sync.read( afterPng );

	if ( before.width !== after.width ) {
		throw new Error(
			`Width mismatch: before=${ before.width }px, after=${ after.width }px. ` +
				'Both screenshots must use the same viewport width.'
		);
	}

	const width = before.width;
	const height = Math.max( before.height, after.height );

	// Pad images to the same height if needed
	const beforeData = padImageHeight( before, height );
	const afterData = padImageHeight( after, height );

	const diff = new PNG( { width, height } );

	const { default: pixelmatch } = await import( 'pixelmatch' );
	const changedPixels = pixelmatch( beforeData, afterData, diff.data, width, height, {
		threshold: 0.1,
		alpha: 0.3,
		diffColor: [ 255, 0, 77 ],
		diffColorAlt: [ 0, 180, 255 ],
	} );

	const totalPixels = width * height;
	const changePercent = Math.round( ( changedPixels / totalPixels ) * 10000 ) / 100;

	return {
		diffPng: PNG.sync.write( diff ),
		changedPixels,
		totalPixels,
		changePercent,
		width,
		height,
	};
}

/**
 * If the image is shorter than targetHeight, return a new RGBA buffer
 * padded with transparent pixels. Otherwise return the original data.
 */
function padImageHeight( png: PNG, targetHeight: number ): Buffer {
	if ( png.height === targetHeight ) {
		return png.data;
	}

	const stride = png.width * 4;
	const padded = Buffer.alloc( stride * targetHeight, 0 ); // transparent
	png.data.copy( padded, 0, 0, stride * png.height );
	return padded;
}

/**
 * In-memory store for reference screenshots, keyed by URL + viewport.
 */
const referenceStore = new Map< string, Buffer >();

function referenceKey( url: string, viewport: string ): string {
	return `${ viewport }::${ url }`;
}

export function storeReference( url: string, viewport: string, png: Buffer ): void {
	referenceStore.set( referenceKey( url, viewport ), png );
}

export function getReference( url: string, viewport: string ): Buffer | undefined {
	return referenceStore.get( referenceKey( url, viewport ) );
}

export function clearReference( url: string, viewport: string ): void {
	referenceStore.delete( referenceKey( url, viewport ) );
}

export function clearAllReferences(): void {
	referenceStore.clear();
}
