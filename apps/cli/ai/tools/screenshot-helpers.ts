import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSharedBrowser } from 'cli/ai/browser-utils';

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

const IMAGE_SETTLE_TIMEOUT_MS = 3000;
const PAGE_SETTLE_TIMEOUT_MS = 2500;

async function waitForPageToSettle( page: Page ): Promise< void > {
	await page
		.waitForLoadState( 'networkidle', { timeout: PAGE_SETTLE_TIMEOUT_MS } )
		.catch( () => {} );
}

/**
 * Capture a PNG screenshot of `url` at the given viewport and return it as a
 * Buffer. Shared by both `take_screenshot` and `share_screenshot`; callers
 * decide whether to expose the image as base64, a temp local file, or an
 * external media event.
 */
export async function captureScreenshotPngBuffer(
	url: string,
	viewport: { width: number; height: number },
	options: { fullPage: boolean; deviceScaleFactor?: number }
): Promise< Buffer > {
	const browser = await getSharedBrowser();
	const page = await browser.newPage( {
		viewport,
		deviceScaleFactor: options.deviceScaleFactor,
	} );

	try {
		await page.emulateMedia( { reducedMotion: 'reduce' } );
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

		const buffer = await page.screenshot( { fullPage: options.fullPage, type: 'png' } );
		return Buffer.from( buffer );
	} finally {
		await page.close();
	}
}

/**
 * Capture a PNG screenshot of `url` at the given viewport and return it as
 * a base64 string. Used by `share_screenshot`, where the remote-session
 * media event carries image bytes directly.
 */
export async function captureScreenshotPng(
	url: string,
	viewport: { width: number; height: number },
	options: { fullPage: boolean; deviceScaleFactor?: number }
): Promise< string > {
	const buffer = await captureScreenshotPngBuffer( url, viewport, options );
	return buffer.toString( 'base64' );
}

export async function saveScreenshotPngToTempFile(
	buffer: Buffer,
	options: { viewportType: string }
): Promise< { path: string; fileUrl: string; name: string; mimeType: 'image/png' } > {
	const directory = await mkdtemp( path.join( os.tmpdir(), 'studio-screenshot-' ) );
	const name = `screenshot-${ options.viewportType }.png`;
	const filePath = path.join( directory, name );

	await writeFile( filePath, buffer );

	return {
		path: filePath,
		fileUrl: pathToFileURL( filePath ).href,
		name,
		mimeType: 'image/png',
	};
}
