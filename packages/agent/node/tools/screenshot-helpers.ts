import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import { resolveScreenshotDirectory } from '@studio/agent/node/screenshot-storage';
import { pageBreakage, pageLayout, pageOverflow, pageTextFit, type TextFit } from './page-layout';
import type { StudioAgentHost } from '@studio/agent/node/host';

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
const MAX_IMAGE_DIMENSION_PX = 8000;

// pi re-encodes larger tool images as much heavier PNGs, and Anthropic rejects
// larger images in requests carrying more than 20 of them.
const MODEL_IMAGE_MAX_EDGE_PX = 2000;

const IMAGE_SETTLE_TIMEOUT_MS = 3000;
const PAGE_SETTLE_TIMEOUT_MS = 2500;

// The requests a page has open, from before it navigates: what it loads
// without them is all it loads, where waiting for 500ms of no network
// activity ('networkidle') adds that half second to every capture.
function trackRequests( page: Page ): () => number {
	const open = new Set< unknown >();
	const done = ( request: unknown ) => open.delete( request );
	page.on( 'request', ( request ) => open.add( request ) );
	page.on( 'requestfinished', done );
	page.on( 'requestfailed', done );
	return () => open.size;
}

// Settled once no request the page made is open across a paint: what it
// loads, and what its scripts fetch as it loads.
async function waitForPageToSettle( page: Page, openRequests: () => number ): Promise< void > {
	const end = Date.now() + PAGE_SETTLE_TIMEOUT_MS;
	const paint = () =>
		page
			.evaluate(
				() =>
					new Promise< void >( ( resolve ) =>
						requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) )
					)
			)
			.catch( () => {} );
	await paint();
	while ( openRequests() > 0 && Date.now() < end ) {
		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		if ( openRequests() === 0 ) {
			await paint();
		}
	}
}

export type ScreenshotFormat = 'png' | 'jpeg';

export const SCREENSHOT_COLOR_SCHEME_VALUES = [ 'light', 'dark' ] as const;
export type ScreenshotColorScheme = ( typeof SCREENSHOT_COLOR_SCHEME_VALUES )[ number ];

/**
 * Apply the prefers-color-scheme emulation a capture asks for.
 */
async function applyScreenshotMediaEmulation(
	page: Page,
	colorScheme?: ScreenshotColorScheme
): Promise< void > {
	await page.emulateMedia( {
		reducedMotion: 'reduce',
		...( colorScheme ? { colorScheme } : {} ),
	} );
}

export interface ScreenshotCapture {
	/** The address actually captured, after redirects. */
	url: string;
	buffer: Buffer;
	modelImage?: { buffer: Buffer; width: number; height: number };
	documentHeight: number;
	/** Bottom edge of the lowest visible element, in CSS pixels from the top. */
	contentHeight: number;
	capturedHeight: number;
	offset: number;
	clipped: boolean;
	/** The page's layout as text, for a model that cannot view the capture. */
	layout?: string[];
	/** Where the page's text does not fit, as the browser lays it out. */
	textFit: TextFit;
}

/** A JPEG copy that fits {@link MODEL_IMAGE_MAX_EDGE_PX}, or undefined when the capture already does. */
async function scaleForModel(
	page: Page,
	capture: Buffer,
	width: number,
	height: number
): Promise< ScreenshotCapture[ 'modelImage' ] > {
	const scale = MODEL_IMAGE_MAX_EDGE_PX / Math.max( width, height );
	if ( scale >= 1 ) {
		return undefined;
	}
	const size = { width: Math.round( width * scale ), height: Math.round( height * scale ) };
	// Not a data: URL, which the site's Content-Security-Policy could block.
	const base64 = await page.evaluate(
		async ( { source, width, height, quality } ) => {
			const bytes = Uint8Array.from( atob( source ), ( char ) => char.charCodeAt( 0 ) );
			const bitmap = await createImageBitmap( new Blob( [ bytes ] ), {
				resizeWidth: width,
				resizeHeight: height,
				resizeQuality: 'high',
			} );
			const canvas = new OffscreenCanvas( width, height );
			canvas.getContext( '2d' )!.drawImage( bitmap, 0, 0 );
			const jpeg = await canvas.convertToBlob( { type: 'image/jpeg', quality } );
			let binary = '';
			for ( const byte of new Uint8Array( await jpeg.arrayBuffer() ) ) {
				binary += String.fromCharCode( byte );
			}
			return btoa( binary );
		},
		{ source: capture.toString( 'base64' ), ...size, quality: MODEL_JPEG_QUALITY / 100 }
	);
	return { buffer: Buffer.from( base64, 'base64' ), ...size };
}

/**
 * Waits for the page's fonts and images. For full-page captures, scrolls through
 * the entire document so lazy-loaded images begin loading; otherwise waits only
 * on images that intersect the first viewport, so above-the-fold shots stay quick.
 */
async function settleImages( page: Page, fullPage: boolean ): Promise< void > {
	return page.evaluate(
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
		{ fullPage, imageSettleTimeoutMs: IMAGE_SETTLE_TIMEOUT_MS }
	);
}

/**
 * Capture a screenshot of `url` at the given viewport. Callers decide whether
 * to expose the image as base64 or a temp local file. Use
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
		forModel?: boolean;
	}
): Promise< ScreenshotCapture > {
	const browser = await getSharedBrowser();
	const page = await browser.newPage( {
		viewport,
		deviceScaleFactor: options.deviceScaleFactor,
	} );
	try {
		await loadPage( page, url, options );
		return await capturePage( page, viewport, options );
	} finally {
		await page.close();
	}
}

// Loads a page as a visitor's browser does, without the admin bar and scrollbars.
async function loadPage(
	page: Page,
	url: string,
	options: { fullPage: boolean; colorScheme?: ScreenshotColorScheme }
) {
	const openRequests = trackRequests( page );
	await applyScreenshotMediaEmulation( page, options.colorScheme );
	const response = await page.goto( url, { waitUntil: 'domcontentloaded', timeout: 30000 } );
	await waitForPageToSettle( page, openRequests );

	await settleImages( page, options.fullPage );

	// Hide the WordPress admin bar and scrollbars for cleaner shots.
	await page.addStyleTag( {
		content: `
			#wpadminbar { display: none !important; }
			html { margin-top: 0 !important; }
			::-webkit-scrollbar { display: none !important; }
			html, body { scrollbar-width: none !important; }
		`,
	} );
	return response;
}

async function capturePage(
	page: Page,
	viewport: { width: number; height: number },
	options: {
		fullPage: boolean;
		deviceScaleFactor?: number;
		format?: ScreenshotFormat;
		offset?: number;
		forModel?: boolean;
	}
): Promise< ScreenshotCapture > {
	const format = options.format ?? 'png';
	const layout = options.forModel === false ? await pageLayout( page ) : undefined;
	const textFit = await pageTextFit( page );
	const dpr = options.deviceScaleFactor ?? 1;
	const maxCssHeight = Math.floor( MAX_IMAGE_DIMENSION_PX / dpr );
	const formatOptions =
		format === 'jpeg'
			? { type: 'jpeg' as const, quality: MODEL_JPEG_QUALITY }
			: { type: 'png' as const };

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
		const buffer = await page.screenshot( { ...formatOptions } );
		return {
			url: page.url(),
			buffer: Buffer.from( buffer ),
			modelImage: options.forModel
				? await scaleForModel( page, buffer, viewport.width * dpr, viewport.height * dpr )
				: undefined,
			documentHeight: viewport.height,
			contentHeight,
			capturedHeight: viewport.height,
			offset: 0,
			clipped: false,
			layout,
			textFit,
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
		url: page.url(),
		buffer: Buffer.from( buffer ),
		modelImage: options.forModel
			? await scaleForModel( page, buffer, viewport.width * dpr, capturedHeight * dpr )
			: undefined,
		documentHeight,
		contentHeight: documentHeight,
		capturedHeight,
		offset,
		clipped: offset + capturedHeight < documentHeight,
		layout,
		textFit,
	};
}

export async function saveScreenshotFile(
	host: StudioAgentHost,
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
	const directory = await resolveScreenshotDirectory( host );
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

/** What a visitor gets that is wrong with a page, at one viewport. */
export interface PageInspection {
	// The address the page ended at, after any redirect.
	url: string;
	problems: string[];
}

interface Render {
	// The page's HTML as served, without its per-request form tokens.
	version: string;
	fullPage: ScreenshotCapture;
	screen: ScreenshotCapture;
}

// The pages Studio last rendered, by address and viewport, as take_screenshot
// captures them for a model that views images. A change to what a site renders
// from that its HTML does not show, such as a stylesheet, forgets them.
const renders = new Map< string, Promise< Render | undefined > >();
let generation = 0;
// By the address a browser requests: a site's root with or without its slash is one page.
const renderKey = ( url: string, viewport: { width: number } ) =>
	`${ URL.canParse( url ) ? new URL( url ).href : url } ${ viewport.width }`;

// Hidden form fields carry tokens WordPress and plugins make for each request
// (wp_nonce_field, a contact form's token), which a visitor does not see.
function pageVersion( html: string ): string {
	return createHash( 'sha256' )
		.update( html.replace( /<input\b[^>]*\btype=["']?hidden["']?[^>]*>/gi, '' ) )
		.digest( 'hex' );
}

/** Forgets every render, as what the pages render from has changed. */
export function forgetRenders(): void {
	generation++;
	renders.clear();
}

/**
 * The capture Studio made of a page when it last rendered it, waiting for one
 * under way, while the page still serves the same HTML.
 */
export async function renderedCapture(
	url: string,
	viewport: { width: number; height: number },
	fullPage: boolean
): Promise< ScreenshotCapture | undefined > {
	const render = await renders.get( renderKey( url, viewport ) );
	if ( ! render ) {
		return undefined;
	}
	const html = await fetch( url, { signal: AbortSignal.timeout( 10000 ) } )
		.then( ( response ) => response.text() )
		.catch( () => undefined );
	if ( html === undefined || pageVersion( html ) !== render.version ) {
		return undefined;
	}
	return fullPage ? render.fullPage : render.screen;
}

/**
 * Loads a page as a visitor's browser does, at one viewport, and states what is
 * broken on it: an error status, PHP's error output, images that do not load
 * and a page wider than the screen. It also captures the page as take_screenshot
 * does for a model that views images, to answer a screenshot of it.
 */
export async function inspectPage(
	url: string,
	viewport: { width: number; height: number }
): Promise< PageInspection > {
	const browser = await getSharedBrowser();
	const page = await browser.newPage( { viewport } );
	const started = generation;
	let finish: ( render: Render | undefined ) => void = () => {};
	const rendering = new Promise< Render | undefined >( ( resolve ) => ( finish = resolve ) );
	renders.set( renderKey( url, viewport ), rendering );
	let render: Render | undefined;
	try {
		const response = await loadPage( page, url, { fullPage: true } );
		const status = response?.status() ?? 0;
		const problems = [
			...( status >= 400 ? [ `The server answers ${ status }.` ] : [] ),
			...( await pageBreakage( page ) ),
			...( await pageOverflow( page ) ),
		];
		const html = await response?.text().catch( () => undefined );
		const options = { format: 'jpeg' as const, forModel: true };
		if ( html !== undefined && status < 400 ) {
			render = {
				version: pageVersion( html ),
				fullPage: await capturePage( page, viewport, { ...options, fullPage: true } ),
				screen: await capturePage( page, viewport, { ...options, fullPage: false } ),
			};
		}
		return { url: page.url(), problems };
	} finally {
		await page.close();
		const current = started === generation ? render : undefined;
		finish( current );
		if ( current && page.url() !== url ) {
			renders.set( renderKey( page.url(), viewport ), rendering );
		}
		if ( ! current && renders.get( renderKey( url, viewport ) ) === rendering ) {
			renders.delete( renderKey( url, viewport ) );
		}
	}
}
