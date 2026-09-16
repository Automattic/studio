import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';

type Browser = Awaited< ReturnType< typeof getSharedBrowser > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

/**
 * Tall portrait viewport used by `take_screenshot` for full-page captures
 * where the agent wants to inspect the whole scrolled page at once.
 */
export const VIEWPORTS = {
	desktop: { width: 1040, height: 1248 },
	mobile: { width: 390, height: 844 },
} as const;

/**
 * Quality used when encoding a screenshot as JPEG. Full-page PNG captures run
 * to multiple megabytes; JPEG at this quality compresses long page captures by
 * roughly 5–10× with no perceptible loss of layout fidelity for the agent.
 */
const MODEL_JPEG_QUALITY = 80;

/**
 * Full-page captures are clipped at this many CSS pixels of height. It is the
 * vision API's hard per-dimension limit, and past it the downscaled strip the
 * model receives (see {@link fitImageToModelResolution}) is under a third of
 * the page's size anyway. Callers pass `offset` to fetch subsequent slices.
 */
export const MAX_IMAGE_DIMENSION_PX = 8000;

/**
 * Native resolution of the vision models Studio Code targets (Claude 4.7 and
 * later): the API downscales anything larger to fit both limits before the
 * model sees it, so sending more pixels only costs upload bytes. A visual
 * token is one 28×28 px patch.
 */
export const MODEL_IMAGE_MAX_EDGE_PX = 2576;
export const MODEL_IMAGE_MAX_TOKENS = 4784;
const MODEL_IMAGE_PATCH_PX = 28;

const IMAGE_SETTLE_TIMEOUT_MS = 3000;
const PAGE_SETTLE_TIMEOUT_MS = 2500;

async function waitForPageToSettle( page: Page ): Promise< void > {
	await page
		.waitForLoadState( 'networkidle', { timeout: PAGE_SETTLE_TIMEOUT_MS } )
		.catch( () => {} );
}

export type ScreenshotFormat = 'png' | 'jpeg';
type ScreenshotMimeType = 'image/png' | 'image/jpeg';

export const SCREENSHOT_COLOR_SCHEME_VALUES = [ 'light', 'dark' ] as const;
export type ScreenshotColorScheme = ( typeof SCREENSHOT_COLOR_SCHEME_VALUES )[ number ];
export const SCREENSHOT_COLOR_SCHEME_DESCRIPTION =
	'Color scheme to emulate: "light" or "dark". Defaults to the browser/system preference.';

/**
 * Apply the media emulation shared by every browser-driving tool. Keeping
 * this in one place guarantees `inspect_design` reports styles under the same
 * prefers-color-scheme mode `take_screenshot` renders.
 */
export async function applyScreenshotMediaEmulation(
	page: Page,
	colorScheme?: ScreenshotColorScheme
): Promise< void > {
	await page.emulateMedia( {
		reducedMotion: 'reduce',
		...( colorScheme ? { colorScheme } : {} ),
	} );
}

export interface ImageSize {
	width: number;
	height: number;
}

/** Visual tokens an image costs the model: one per 28×28 px patch. */
export function countImageTokens( { width, height }: ImageSize ): number {
	return Math.ceil( width / MODEL_IMAGE_PATCH_PX ) * Math.ceil( height / MODEL_IMAGE_PATCH_PX );
}

// The API rounds the short edge half to even; Math.round would pick a
// different size for some images.
function roundTiesToEven( value: number ): number {
	const floor = Math.floor( value );
	if ( value - floor !== 0.5 ) {
		return Math.round( value );
	}
	return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The size the vision API reduces an image to before the model sees it
 * (Anthropic's reference implementation): the largest aspect-preserving size
 * whose patch-padded edges stay within {@link MODEL_IMAGE_MAX_EDGE_PX} and
 * whose visual tokens stay within {@link MODEL_IMAGE_MAX_TOKENS}. An image
 * that already fits is returned unchanged.
 */
export function fitImageToModelResolution( { width, height }: ImageSize ): ImageSize {
	const fits = ( size: ImageSize ) =>
		Math.ceil( size.width / MODEL_IMAGE_PATCH_PX ) * MODEL_IMAGE_PATCH_PX <=
			MODEL_IMAGE_MAX_EDGE_PX &&
		Math.ceil( size.height / MODEL_IMAGE_PATCH_PX ) * MODEL_IMAGE_PATCH_PX <=
			MODEL_IMAGE_MAX_EDGE_PX &&
		countImageTokens( size ) <= MODEL_IMAGE_MAX_TOKENS;
	if ( fits( { width, height } ) ) {
		return { width, height };
	}
	if ( height > width ) {
		const rotated = fitImageToModelResolution( { width: height, height: width } );
		return { width: rotated.height, height: rotated.width };
	}
	// Binary search along the long edge for the largest size that fits.
	const aspectRatio = width / height;
	const shortEdge = ( longEdge: number ) =>
		Math.max( roundTiesToEven( longEdge / aspectRatio ), 1 );
	let lo = 1;
	let hi = width;
	while ( lo + 1 < hi ) {
		const mid = Math.floor( ( lo + hi ) / 2 );
		if ( fits( { width: mid, height: shortEdge( mid ) } ) ) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return { width: lo, height: shortEdge( lo ) };
}

/**
 * Height of the full-width slices a capture is cut into when the caller asks
 * for tiles: the tallest slice the model still sees at 100% scale.
 */
export function modelImageTileHeight( width: number ): number {
	const rowTokens = Math.ceil( width / MODEL_IMAGE_PATCH_PX );
	return Math.min(
		MODEL_IMAGE_MAX_EDGE_PX,
		Math.floor( MODEL_IMAGE_MAX_TOKENS / rowTokens ) * MODEL_IMAGE_PATCH_PX
	);
}

/** An image block prepared for the model: a region of the capture, encoded. */
export interface ModelImage extends ImageSize {
	buffer: Buffer;
	/** The rows of the capture this image shows, in CSS pixels from its top. */
	rowStart: number;
	rowEnd: number;
}

interface ImageRegion extends ImageSize {
	sx: number;
	sy: number;
	sw: number;
	sh: number;
}

/**
 * Re-encode regions of an encoded image at the requested sizes on an in-page
 * canvas. The browser already holds a decoder and a high-quality resampler,
 * which spares the CLI a native image dependency.
 */
async function renderImageRegions(
	page: Page,
	source: Buffer,
	mimeType: ScreenshotMimeType,
	regions: ImageRegion[]
): Promise< Buffer[] > {
	const dataUrls = await page.evaluate(
		async ( { source, mimeType, regions, quality } ) => {
			const blob = await ( await fetch( source ) ).blob();
			const canvas = document.createElement( 'canvas' );
			const context = canvas.getContext( '2d' );
			if ( ! context ) {
				throw new Error( 'Canvas 2D context unavailable' );
			}
			const encoded: string[] = [];
			for ( const region of regions ) {
				const bitmap = await createImageBitmap( blob, region.sx, region.sy, region.sw, region.sh, {
					resizeWidth: region.width,
					resizeHeight: region.height,
					resizeQuality: 'high',
				} );
				canvas.width = region.width;
				canvas.height = region.height;
				context.drawImage( bitmap, 0, 0 );
				bitmap.close();
				const output = await new Promise< Blob | null >( ( resolve ) =>
					canvas.toBlob( resolve, mimeType, quality )
				);
				if ( ! output ) {
					throw new Error( 'Canvas encoding failed' );
				}
				encoded.push(
					await new Promise< string >( ( resolve, reject ) => {
						const reader = new FileReader();
						reader.onload = () => resolve( reader.result as string );
						reader.onerror = () => reject( reader.error );
						reader.readAsDataURL( output );
					} )
				);
			}
			return encoded;
		},
		{
			source: `data:${ mimeType };base64,${ source.toString( 'base64' ) }`,
			mimeType,
			regions,
			quality: MODEL_JPEG_QUALITY / 100,
		}
	);
	return dataUrls.map( ( dataUrl ) =>
		Buffer.from( dataUrl.slice( dataUrl.indexOf( ',' ) + 1 ), 'base64' )
	);
}

/**
 * Prepare the image blocks the model receives for a capture of `size` pixels:
 * the whole capture fitted to the model's native resolution, or — with
 * `tiles` — full-width slices it sees at 100% scale. A capture that already
 * fits is passed through untouched.
 */
async function prepareModelImages(
	page: Page,
	capture: Buffer,
	mimeType: ScreenshotMimeType,
	size: ImageSize,
	dpr: number,
	tiles: boolean
): Promise< ModelImage[] > {
	const toRows = ( pixels: number ) => Math.round( pixels / dpr );
	if ( ! tiles ) {
		const fitted = fitImageToModelResolution( size );
		if ( fitted.width === size.width && fitted.height === size.height ) {
			return [ { buffer: capture, ...size, rowStart: 0, rowEnd: toRows( size.height ) } ];
		}
		const [ buffer ] = await renderImageRegions( page, capture, mimeType, [
			{ sx: 0, sy: 0, sw: size.width, sh: size.height, ...fitted },
		] );
		return [ { buffer, ...fitted, rowStart: 0, rowEnd: toRows( size.height ) } ];
	}
	const tileHeight = modelImageTileHeight( size.width );
	if ( size.height <= tileHeight ) {
		return [ { buffer: capture, ...size, rowStart: 0, rowEnd: toRows( size.height ) } ];
	}
	const regions: ImageRegion[] = [];
	for ( let sy = 0; sy < size.height; sy += tileHeight ) {
		const sh = Math.min( tileHeight, size.height - sy );
		regions.push( { sx: 0, sy, sw: size.width, sh, width: size.width, height: sh } );
	}
	const buffers = await renderImageRegions( page, capture, mimeType, regions );
	return regions.map( ( region, index ) => ( {
		buffer: buffers[ index ],
		width: region.width,
		height: region.height,
		rowStart: toRows( region.sy ),
		rowEnd: toRows( region.sy + region.sh ),
	} ) );
}

export interface ScreenshotCapture {
	/** The full-resolution capture, for the saved file and the user. */
	buffer: Buffer;
	/**
	 * What the model is shown, when the caller asked for `modelImages`: the
	 * capture fitted to the model's native resolution, or its full-scale tiles.
	 */
	modelImages?: ModelImage[];
	documentHeight: number;
	/** Bottom edge of the lowest visible element, in CSS pixels from the top. */
	contentHeight: number;
	capturedHeight: number;
	offset: number;
	clipped: boolean;
}

/**
 * Capture a screenshot of `url` at the given viewport. Callers decide whether
 * to expose the image as base64 or a temp local file. Use `jpeg` for
 * vision-model input — full-page PNGs balloon to multi-MB.
 *
 * Full-page captures are clipped to {@link MAX_IMAGE_DIMENSION_PX} raw pixels
 * tall (accounting for `deviceScaleFactor`); pass `offset` in CSS pixels to
 * capture a subsequent slice of a long page. Returned metadata tells callers
 * whether the page was clipped and how much remains.
 *
 * `modelImages: 'fit'` also returns the capture downscaled to the resolution
 * the vision API would reduce it to anyway, so the model sees the same pixels
 * for a fraction of the bytes; `'tiles'` returns full-width slices instead,
 * each small enough to reach the model at 100% scale.
 */
export async function captureScreenshotBuffer(
	url: string,
	viewport: { width: number; height: number },
	options: {
		fullPage: boolean;
		deviceScaleFactor?: number;
		format?: ScreenshotFormat;
		offset?: number;
		colorScheme?: ScreenshotColorScheme;
		modelImages?: 'fit' | 'tiles';
	}
): Promise< ScreenshotCapture > {
	const format = options.format ?? 'png';
	const mimeType: ScreenshotMimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
	const browser = await getSharedBrowser();
	const page = await browser.newPage( {
		viewport,
		deviceScaleFactor: options.deviceScaleFactor,
	} );

	try {
		await applyScreenshotMediaEmulation( page, options.colorScheme );
		await page.goto( url, { waitUntil: 'domcontentloaded', timeout: 30000 } );
		await waitForPageToSettle( page );

		// For full-page captures, scroll through the entire document so
		// lazy-loaded images can begin loading. For viewport captures we keep
		// the page where it is and only wait on images that intersect the
		// first viewport, so above-the-fold shots stay quick on long pages.
		await page.evaluate(
			async ( { fullPage, imageSettleTimeoutMs } ) => {
				const delay = ( ms: number ) =>
					new Promise< void >( ( resolve ) => setTimeout( resolve, ms ) );
				const waitForPaint = () =>
					new Promise< void >( ( resolve ) => {
						requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) );
					} );

				await Promise.race( [ document.fonts?.ready ?? Promise.resolve(), delay( 1000 ) ] );

				if ( fullPage ) {
					const scrollHeight = Math.max(
						document.body.scrollHeight,
						document.documentElement.scrollHeight
					);
					const viewportHeight = window.innerHeight;
					for ( let y = 0; y < scrollHeight; y += viewportHeight ) {
						window.scrollTo( 0, y );
						await waitForPaint();
					}
					window.scrollTo( 0, 0 );
				}

				const pendingImages = Array.from( document.images ).filter( ( img ) => {
					if ( img.complete ) {
						return false;
					}
					if ( fullPage ) {
						return true;
					}
					const rect = img.getBoundingClientRect();
					return rect.bottom > 0 && rect.top < window.innerHeight;
				} );
				const timeout = delay( imageSettleTimeoutMs );
				const allImages = Promise.all(
					pendingImages.map(
						( img ) =>
							new Promise< void >( ( resolve ) => {
								img.addEventListener( 'load', () => resolve(), { once: true } );
								img.addEventListener( 'error', () => resolve(), { once: true } );
							} )
					)
				);
				await Promise.race( [ allImages, timeout ] );
			},
			{ fullPage: options.fullPage, imageSettleTimeoutMs: IMAGE_SETTLE_TIMEOUT_MS }
		);

		// Hide the WordPress admin bar and scrollbars for cleaner shots.
		await page.addStyleTag( {
			content: `
				#wpadminbar { display: none !important; }
				html { margin-top: 0 !important; }
				::-webkit-scrollbar { display: none !important; }
				html, body { scrollbar-width: none !important; }
			`,
		} );

		const dpr = options.deviceScaleFactor ?? 1;
		const maxCssHeight = Math.floor( MAX_IMAGE_DIMENSION_PX / dpr );
		const formatOptions =
			format === 'jpeg'
				? { type: 'jpeg' as const, quality: MODEL_JPEG_QUALITY }
				: { type: 'png' as const };
		const prepareModelImagesFor = ( capture: Buffer, cssHeight: number ) =>
			options.modelImages
				? prepareModelImages(
						page,
						capture,
						mimeType,
						{ width: Math.round( viewport.width * dpr ), height: Math.round( cssHeight * dpr ) },
						dpr,
						options.modelImages === 'tiles'
				  )
				: undefined;

		if ( ! options.fullPage ) {
			const contentHeight = await page.evaluate( () =>
				Math.ceil(
					Array.from( document.body.querySelectorAll( '*' ) ).reduce( ( bottom, element ) => {
						const rect = element.getBoundingClientRect();
						return rect.width > 0 && rect.height > 0
							? Math.max( bottom, rect.bottom + window.scrollY )
							: bottom;
					}, 0 )
				)
			);
			const buffer = Buffer.from( await page.screenshot( { ...formatOptions } ) );
			return {
				buffer,
				modelImages: await prepareModelImagesFor( buffer, viewport.height ),
				documentHeight: viewport.height,
				contentHeight,
				capturedHeight: viewport.height,
				offset: 0,
				clipped: false,
			};
		}

		const documentHeight = await page.evaluate( () =>
			Math.max( document.body.scrollHeight, document.documentElement.scrollHeight )
		);
		const offset = Math.max( 0, Math.floor( options.offset ?? 0 ) );
		if ( offset >= documentHeight ) {
			throw new Error(
				`offset ${ offset } exceeds document height ${ documentHeight }; nothing to capture.`
			);
		}
		const remaining = documentHeight - offset;
		const capturedHeight = Math.min( remaining, maxCssHeight );
		// `fullPage: true` is required alongside `clip` so Playwright renders
		// the entire document and crops to the requested region. Without it,
		// the "resulting image" is the viewport and any clip.y beyond the
		// viewport height fails with "Clipped area is either empty or outside
		// the resulting image".
		const buffer = Buffer.from(
			await page.screenshot( {
				...formatOptions,
				fullPage: true,
				clip: { x: 0, y: offset, width: viewport.width, height: capturedHeight },
			} )
		);
		return {
			buffer,
			modelImages: await prepareModelImagesFor( buffer, capturedHeight ),
			documentHeight,
			contentHeight: documentHeight,
			capturedHeight,
			offset,
			clipped: offset + capturedHeight < documentHeight,
		};
	} finally {
		await page.close();
	}
}

export async function saveScreenshotFile(
	buffer: Buffer,
	options: { viewportType: string; format?: ScreenshotFormat; colorScheme?: ScreenshotColorScheme }
): Promise< {
	path: string;
	fileUrl: string;
	name: string;
	mimeType: ScreenshotMimeType;
} > {
	const format = options.format ?? 'png';
	const extension = format === 'jpeg' ? 'jpg' : 'png';
	const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
	const directory = await resolveScreenshotDirectory();
	const colorSchemeSuffix = options.colorScheme ? `-${ options.colorScheme }` : '';
	// The directory can be shared by every capture in a session, so the file
	// name carries a random suffix to keep earlier captures addressable.
	const name = `screenshot-${ options.viewportType }${ colorSchemeSuffix }-${ randomUUID().slice(
		0,
		8
	) }.${ extension }`;
	const filePath = path.join( directory, name );

	await writeFile( filePath, buffer );

	return {
		path: filePath,
		fileUrl: pathToFileURL( filePath ).href,
		name,
		mimeType,
	};
}
