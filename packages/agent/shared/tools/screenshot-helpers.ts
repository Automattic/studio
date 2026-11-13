import { toBase64, fromBase64 } from '@studio/agent/shared/base64';
import {
	pageBandGaps,
	pageBreakage,
	pageContrast,
	pageHeaderWraps,
	pageLargeText,
	pageSticky,
	pageLayout,
	pageOverflow,
	pageSqueezedText,
	pageTextFit,
	pageWideTextBreaks,
	type TextFit,
} from './page-layout';
import type { HostPage, HostPages, StudioAgentHost } from '@studio/agent/shared/host';

type Page = HostPage;

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
type ScreenshotFormat = 'png' | 'jpeg';

export const SCREENSHOT_COLOR_SCHEME_VALUES = [ 'light', 'dark' ] as const;
export type ScreenshotColorScheme = ( typeof SCREENSHOT_COLOR_SCHEME_VALUES )[ number ];

/**
 * The page options shared by every tool that renders a page for the agent, so
 * every check reads styles under the same prefers-color-scheme mode
 * `take_screenshot` renders.
 */
export function screenshotPageOptions( colorScheme?: ScreenshotColorScheme ) {
	return { reducedMotion: true, ...( colorScheme ? { colorScheme } : {} ) };
}

export interface ScreenshotCapture {
	/** The address actually captured, after redirects. */
	url: string;
	buffer: Uint8Array;
	modelImage?: { buffer: Uint8Array; width: number; height: number };
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
	page: HostPage,
	capture: Uint8Array,
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
		{ source: toBase64( capture ), ...size, quality: MODEL_JPEG_QUALITY / 100 }
	);
	return { buffer: fromBase64( base64 ), ...size };
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
					// At once, as a theme's `scroll-behavior: smooth` would only start it.
					window.scrollTo( { top: y, behavior: 'instant' } );
					await waitForPaint();
				}
				window.scrollTo( { top: 0, behavior: 'instant' } );
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
	pages: HostPages,
	target: { url: string } | { html: string },
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
	const page = await loadPage( pages, target, viewport, options );
	try {
		return await capturePage( page, viewport, options );
	} finally {
		await page.close();
	}
}

// Loads a page as a visitor's browser does, without the admin bar and scrollbars.
async function loadPage(
	pages: HostPages,
	target: { url: string } | { html: string },
	viewport: { width: number; height: number },
	options: { fullPage: boolean; deviceScaleFactor?: number; colorScheme?: ScreenshotColorScheme }
): Promise< Page > {
	const page = await pages.open( target, {
		viewport,
		deviceScaleFactor: options.deviceScaleFactor,
		...screenshotPageOptions( options.colorScheme ),
	} );
	try {
		await settleImages( page, options.fullPage );
		// Hide the WordPress admin bar and scrollbars for cleaner shots.
		await page.evaluate( () => {
			const style = document.createElement( 'style' );
			style.textContent = `
				#wpadminbar { display: none !important; }
				html { margin-top: 0 !important; }
				::-webkit-scrollbar { display: none !important; }
				html, body { scrollbar-width: none !important; }
			`;
			document.head.appendChild( style );
		} );
		return page;
	} catch ( error ) {
		await page.close().catch( () => {} );
		throw error;
	}
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
		// The page's text fit, when the caller has read it from the page as it is.
		textFit?: TextFit;
	}
): Promise< ScreenshotCapture > {
	const format = options.format ?? 'png';
	const layout = options.forModel === false ? await pageLayout( page ) : undefined;
	const textFit = options.textFit ?? ( await pageTextFit( page ) );
	const dpr = options.deviceScaleFactor ?? 1;
	const maxCssHeight = Math.floor( MAX_IMAGE_DIMENSION_PX / dpr );
	const formatOptions =
		format === 'jpeg'
			? { format: 'jpeg' as const, quality: MODEL_JPEG_QUALITY }
			: { format: 'png' as const };

	let buffer: Uint8Array;
	let documentHeight: number;
	let contentHeight: number;
	let capturedHeight: number;
	let offset: number;
	if ( ! options.fullPage ) {
		contentHeight = await page.evaluate( () =>
			Math.ceil(
				Array.from( document.body.querySelectorAll( '*' ) ).reduce( ( bottom, element ) => {
					const rect = element.getBoundingClientRect();
					return rect.width > 0 && rect.height > 0
						? Math.max( bottom, rect.bottom + window.scrollY )
						: bottom;
				}, 0 )
			)
		);
		buffer = await page.screenshot( { ...formatOptions } );
		documentHeight = viewport.height;
		capturedHeight = viewport.height;
		offset = 0;
	} else {
		documentHeight = await page.evaluate( () =>
			Math.max( document.body.scrollHeight, document.documentElement.scrollHeight )
		);
		offset = Math.max( 0, Math.floor( options.offset ?? 0 ) );
		if ( offset >= documentHeight ) {
			throw new Error(
				`offset ${ offset } exceeds document height ${ documentHeight }; nothing to capture.`
			);
		}
		const remaining = documentHeight - offset;
		capturedHeight = Math.min( remaining, maxCssHeight );
		// A full-page capture keeps the viewport's size and paints a background
		// fixed to the viewport (`background-attachment: fixed`, as a page's
		// gradient or a parallax cover block uses) over the first screen only,
		// leaving it white further down, where a visitor sees it behind every
		// screen. Attached to its element for the capture, it paints wherever its
		// element is.
		const fixed = await page.evaluate(
			() =>
				Array.from( document.querySelectorAll< HTMLElement >( '*' ) ).filter( ( element ) => {
					if ( ! getComputedStyle( element ).backgroundAttachment.includes( 'fixed' ) ) {
						return false;
					}
					element.dataset.studioFixedBackground =
						element.style.getPropertyValue( 'background-attachment' );
					element.style.setProperty( 'background-attachment', 'scroll', 'important' );
					return true;
				} ).length
		);
		// `fullPage: true` is required alongside `clip` so Playwright renders
		// the entire document and crops to the requested region. Without it,
		// the "resulting image" is the viewport and any clip.y beyond the
		// viewport height fails with "Clipped area is either empty or outside
		// the resulting image".
		buffer = await page.screenshot( {
			...formatOptions,
			fullPage: true,
			clip: { x: 0, y: offset, width: viewport.width, height: capturedHeight },
		} );
		if ( fixed ) {
			await page.evaluate( () => {
				for ( const element of document.querySelectorAll< HTMLElement >(
					'[data-studio-fixed-background]'
				) ) {
					const before = element.dataset.studioFixedBackground ?? '';
					element.style.removeProperty( 'background-attachment' );
					if ( before ) {
						element.style.setProperty( 'background-attachment', before );
					}
					delete element.dataset.studioFixedBackground;
				}
			} );
		}
		contentHeight = documentHeight;
	}
	return {
		url: page.url(),
		buffer,
		modelImage: options.forModel
			? await scaleForModel( page, buffer, viewport.width * dpr, capturedHeight * dpr )
			: undefined,
		documentHeight,
		contentHeight,
		capturedHeight,
		offset,
		clipped: offset + capturedHeight < documentHeight,
		layout,
		textFit,
	};
}

export async function saveScreenshotFile(
	host: StudioAgentHost,
	buffer: Uint8Array,
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
	const colorSchemeSuffix = options.colorScheme ? `-${ options.colorScheme }` : '';
	// The directory can be shared by every capture in a session, so the file
	// name carries a random suffix to keep earlier captures addressable.
	const name = `screenshot-${ options.viewportType }${ colorSchemeSuffix }-${ crypto
		.randomUUID()
		.slice( 0, 8 ) }.${ extension }`;
	const saved = await host.saveImage( buffer, name, mimeType );
	return { path: saved.path, fileUrl: saved.url, name, mimeType };
}

/** What a visitor gets that is wrong with a page, at one viewport. */
export interface PageInspection {
	// The address the page ended at, after any redirect.
	url: string;
	problems: string[];
	// The usual size of its body text in px: the median computed font size of
	// the paragraphs outside the header and footer, if it has any.
	bodyFontSize?: number;
}

// The median computed font size of the visible paragraphs, with some text,
// outside the page's header and footer.
async function bodyFontSize( page: Page ): Promise< number | undefined > {
	return page
		.evaluate( () => {
			const sizes = [ ...document.querySelectorAll( 'p' ) ]
				.filter( ( el ) => {
					const box = el.getBoundingClientRect();
					return (
						box.width > 0 &&
						box.height > 0 &&
						( el.textContent ?? '' ).trim().length > 20 &&
						! el.closest( 'header, footer' )
					);
				} )
				.map( ( el ) => parseFloat( getComputedStyle( el ).fontSize ) )
				.sort( ( a, b ) => a - b );
			return sizes.length ? sizes[ Math.floor( sizes.length / 2 ) ] : null;
		} )
		.then( ( size ) => size ?? undefined )
		.catch( () => undefined );
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
async function pageVersion( html: string ): Promise< string > {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode( html.replace( /<input\b[^>]*\btype=["']?hidden["']?[^>]*>/gi, '' ) )
	);
	return toBase64( new Uint8Array( digest ) );
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
	pages: HostPages,
	url: string,
	viewport: { width: number; height: number },
	fullPage: boolean
): Promise< ScreenshotCapture | undefined > {
	const captured = await renders.get( renderKey( url, viewport ) );
	if ( ! captured ) {
		return undefined;
	}
	const html = await pages
		.fetchText( url )
		.then( ( { body } ) => body )
		.catch( () => undefined );
	if ( html === undefined || ( await pageVersion( html ) ) !== captured.version ) {
		return undefined;
	}
	return fullPage ? captured.fullPage : captured.screen;
}

/**
 * Loads a page as a visitor's browser does, at one viewport, and states what is
 * broken on it: an error status, PHP's error output, images that do not load,
 * a page wider than the screen and text against its edge. It also captures the page as take_screenshot
 * does for a model that views images, to answer a screenshot of it.
 */
export async function inspectPage(
	pages: HostPages,
	url: string,
	viewport: { width: number; height: number }
): Promise< PageInspection > {
	const started = generation;
	let finish: ( render: Render | undefined ) => void = () => {};
	const rendering = new Promise< Render | undefined >( ( resolve ) => ( finish = resolve ) );
	renders.set( renderKey( url, viewport ), rendering );
	let render: Render | undefined;
	let page: Page | undefined;
	try {
		page = await loadPage( pages, { url }, viewport, { fullPage: true } );
		const status = page.status();
		const textFit = await pageTextFit( page );
		const body = await bodyFontSize( page );
		const problems = [
			...( status >= 400 ? [ `The server answers ${ status }.` ] : [] ),
			...( await pageBreakage( page ) ),
			...( await pageOverflow( page ) ),
			...( await pageBandGaps( page ) ),
			...( await pageHeaderWraps( page ) ),
			...( await pageContrast( page ) ),
			...( await pageLargeText( page, body ) ),
			...( await pageSticky( page ) ),
			// A heading and the lines under it are one problem, so a report that
			// lists a problem the same on several pages once keeps them together.
			...( textFit.edges.length
				? [
						[
							"Text against the viewport's edge:",
							...textFit.edges.map( ( line ) => `  ${ line }` ),
						].join( '\n' ),
				  ]
				: [] ),
		];
		const html = await page.html();
		const options = { format: 'jpeg' as const, forModel: true, textFit };
		if ( html !== undefined && status < 400 ) {
			render = {
				version: await pageVersion( html ),
				fullPage: await capturePage( page, viewport, { ...options, fullPage: true } ),
				screen: await capturePage( page, viewport, { ...options, fullPage: false } ),
			};
		}
		// After the captures, as they lay the page out wider and back. On a
		// desktop only, as a phone's one column is narrow by design.
		if ( viewport.width === VIEWPORTS.desktop.width ) {
			const squeezed = await pageSqueezedText( page );
			if ( squeezed.length ) {
				problems.push( squeezed.join( '\n' ) );
			}
			const wideBreaks = await pageWideTextBreaks( page );
			if ( wideBreaks.length ) {
				problems.push( wideBreaks.join( '\n' ) );
			}
		}
		return { url: page.url(), problems, bodyFontSize: body };
	} finally {
		const finalUrl = page?.url() ?? url;
		await page?.close();
		const current = started === generation ? render : undefined;
		finish( current );
		if ( current && finalUrl !== url ) {
			renders.set( renderKey( finalUrl, viewport ), rendering );
		}
		if ( ! current && renders.get( renderKey( url, viewport ) ) === rendering ) {
			renders.delete( renderKey( url, viewport ) );
		}
	}
}
