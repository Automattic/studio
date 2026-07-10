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
 * 16:9 viewport used by `share_screenshot` to capture "as it would look on a
 * screen" — an above-the-fold view of the rendered page. The user can ask
 * for the full page explicitly by setting `fullPage: true`.
 */
export const SHARE_VIEWPORTS = {
	desktop: { width: 1280, height: 720 },
	mobile: { width: 390, height: 844 },
} as const;

/**
 * Render `share_screenshot` at 2x DPR so the captured PNG has retina pixel
 * density (e.g. 2560x1440 raw pixels for the desktop viewport) without
 * changing CSS layout breakpoints. The page still sees a 1280x720 window;
 * only the rasterized output is denser. This survives Telegram's compression
 * pipeline noticeably better than 1x captures.
 */
export const SHARE_DEVICE_SCALE_FACTOR = 2;

/**
 * Quality used when re-encoding a screenshot as JPEG for vision-model input.
 * Full-page PNG captures can run to multiple megabytes; the wpcom AI proxy
 * rejects oversized request bodies with an empty 400 before they ever reach
 * the model. JPEG at this quality compresses long page captures by roughly
 * 5–10× with no perceptible loss of layout fidelity for the agent.
 */
const MODEL_JPEG_QUALITY = 80;

/**
 * Anthropic's vision API rejects images whose pixel width OR height exceeds
 * 8000. Long full-page captures of design-heavy sites blow past this in the
 * height dimension; clip the capture region to keep us inside the limit and
 * let callers pass `offset` to fetch subsequent slices on follow-up calls.
 */
export const MAX_IMAGE_DIMENSION_PX = 8000;

const IMAGE_SETTLE_TIMEOUT_MS = 3000;
const PAGE_SETTLE_TIMEOUT_MS = 2500;

async function waitForPageToSettle( page: Page ): Promise< void > {
	await page
		.waitForLoadState( 'networkidle', { timeout: PAGE_SETTLE_TIMEOUT_MS } )
		.catch( () => {} );
}

export type ScreenshotFormat = 'png' | 'jpeg';

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

export interface ScreenshotCapture {
	buffer: Buffer;
	documentHeight: number;
	capturedHeight: number;
	offset: number;
	clipped: boolean;
}

/**
 * Capture a screenshot of `url` at the given viewport. Shared by both
 * `take_screenshot` and `share_screenshot`; callers decide whether to expose
 * the image as base64, a temp local file, or an external media event. Use
 * `jpeg` for vision-model input — full-page PNGs balloon to multi-MB and
 * trip the wpcom AI proxy's request-size limit.
 *
 * Full-page captures are clipped to {@link MAX_IMAGE_DIMENSION_PX} raw pixels
 * tall (accounting for `deviceScaleFactor`); pass `offset` in CSS pixels to
 * capture a subsequent slice of a long page. Returned metadata tells callers
 * whether the page was clipped and how much remains.
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
	}
): Promise< ScreenshotCapture > {
	const format = options.format ?? 'png';
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

		if ( ! options.fullPage ) {
			const buffer = await page.screenshot( { ...formatOptions } );
			return {
				buffer: Buffer.from( buffer ),
				documentHeight: viewport.height,
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
		const buffer = await page.screenshot( {
			...formatOptions,
			fullPage: true,
			clip: { x: 0, y: offset, width: viewport.width, height: capturedHeight },
		} );
		return {
			buffer: Buffer.from( buffer ),
			documentHeight,
			capturedHeight,
			offset,
			clipped: offset + capturedHeight < documentHeight,
		};
	} finally {
		await page.close();
	}
}

/**
 * Capture a PNG screenshot and return it as a base64 string. Used by
 * `share_screenshot`, where retina-quality PNG survives Telegram's
 * compression pipeline noticeably better than JPEG (see
 * {@link SHARE_DEVICE_SCALE_FACTOR}).
 */
export async function captureScreenshotPng(
	url: string,
	viewport: { width: number; height: number },
	options: {
		fullPage: boolean;
		deviceScaleFactor?: number;
		colorScheme?: ScreenshotColorScheme;
	}
): Promise< string > {
	const capture = await captureScreenshotBuffer( url, viewport, { ...options, format: 'png' } );
	return capture.buffer.toString( 'base64' );
}

export async function saveScreenshotFile(
	buffer: Buffer,
	options: { viewportType: string; format?: ScreenshotFormat; colorScheme?: ScreenshotColorScheme }
): Promise< {
	path: string;
	fileUrl: string;
	name: string;
	mimeType: 'image/png' | 'image/jpeg';
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
