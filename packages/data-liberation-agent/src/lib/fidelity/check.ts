// src/lib/fidelity/check.ts
//
// Compare a liberated copy against its live source at viewports the capture
// sweep never sampled. Measuring only at the capture width would certify the
// freeze we already shipped once.
//
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { startStaticServer } from '../replicate/local-site/static-server.js';
import { DEFAULT_SWEEP_WIDTHS } from '../screenshot/fluid-capture.js';
import { runFidelityChecks } from './checks.js';
import { writePixelEvidence } from './evidence.js';
import { checkSelfConsistency, type SelfConsistencyReport } from './self-consistency.js';
import {
	scoreReport,
	scoreViewport,
	normalizeImageKey,
	type DialogProbe,
	type HashTarget,
	type LayoutObservation,
	type ViewportScore,
} from './score.js';

const MAX_ROUTE_CHECKS = 32;

/** Routes compared against the live source by default. Each costs a browser round trip. */
const BROWSER_ROUTE_SAMPLE = 4;

/**
 * Widths the learning sweep does not visit. 1600 and 1728 sit above the
 * capture width and are what exposed the freeze. 900 is omitted on purpose:
 * per-device sources switch documents by CSS at the detected floor, while a
 * desktop-UA load of the live source does not, so that width compares two
 * different designs.
 */
export const DEFAULT_CHECK_WIDTHS = [ 1600, 1728 ];

export type ObservePair = (
	sourceUrl: string,
	localUrl: string,
	viewport: number
) => Promise< {
	source: LayoutObservation;
	liberated: LayoutObservation;
	sourcePng?: Buffer;
	liberatedPng?: Buffer;
} >;

export interface FidelityCheckOptions {
	directory: string;
	widths?: number[];
	/** Pathnames to check, e.g. `/` and `/about/`. Default: homepage only. */
	routes?: string[];
	settleMs?: number;
	/** How many routes to compare against the live source. */
	sampleSize?: number;
	/** Write source/liberated/diff PNGs. Never used as pass/fail. */
	screenshots?: boolean;
	log?: ( ( message: string ) => void ) | undefined;
	observe?: ObservePair;
}

/** A score, told which route produced it. */
export type RouteScore = ViewportScore & { route: string };

export interface FidelityReport {
	sourceUrl: string;
	websiteDir: string;
	widths: number[];
	/** Routes actually measured. */
	routes: string[];
	/** Routes the capture retained. */
	routesAvailable: number;
	/** Offline checks over every route. */
	selfConsistency: SelfConsistencyReport;
	scores: RouteScore[];
	pass: boolean;
	failed: number;
	passed: number;
}

interface CaptureReceipt {
	source?: { url?: string };
	websiteRoot?: string;
	routes?: Array< { url?: string; path?: string } >;
}

/**
 * One spelling for a route in the copy, so `/about`, `/about/`, and
 * `/about/index.html` are the same place. Extensions other than a directory
 * index are left alone, because `/feed.xml` is a file rather than a directory.
 */
/** Route in the copy → its file, relative to the website directory. */
export function routeFiles( receipt: CaptureReceipt ): Map< string, string > {
	const websiteRoot = ( receipt.websiteRoot ?? 'website' ).replace( /\\/g, '/' ).replace( /\/*$/, '' );
	const files = new Map< string, string >();
	for ( const route of receipt.routes ?? [] ) {
		if ( ! route?.url || ! route?.path ) continue;
		const path = route.path.replace( /\\/g, '/' );
		const relative =
			websiteRoot && path.startsWith( `${ websiteRoot }/` )
				? path.slice( websiteRoot.length + 1 )
				: path;
		files.set( canonicalRoutePath( `/${ relative.replace( /^\/*/, '' ) }` ), relative );
	}
	return files;
}

/**
 * Pick `limit` routes spread evenly across the list, entrypoint first.
 *
 * Even spacing is the point. Taking the first N of an alphabetical list on a
 * site with sixty posts and a shop page spends every check inside /blog/ and
 * never reaches /shop/.
 */
export function spreadSample( routes: string[], limit: number ): string[] {
	if ( limit <= 0 ) return [];
	if ( routes.length <= limit ) return [ ...routes ];
	const [ first, ...rest ] = routes as [ string, ...string[] ];
	const picks = [ first ];
	const take = limit - 1;
	// Span both ends of the remainder. Stopping short leaves whatever sorts last
	// — often the very sections a blog was burying — permanently unmeasured.
	for ( let index = 0; index < take; index++ ) {
		const position = take === 1 ? rest.length - 1 : Math.round( ( index * ( rest.length - 1 ) ) / ( take - 1 ) );
		const candidate = rest[ position ];
		if ( candidate && ! picks.includes( candidate ) ) picks.push( candidate );
	}
	return picks;
}

/** Filesystem-safe stem for a route, so per-route evidence cannot collide. */
export function evidenceSlug( route: string ): string {
	const slug = route.replace( /[^a-z0-9]+/gi, '-' ).replace( /^-+|-+$/g, '' );
	return slug || 'index';
}

export function canonicalRoutePath( route: string ): string {
	const path = route.replace( /\\/g, '/' ).replace( /^\/*/, '/' ).split( /[?#]/ )[ 0 ] ?? '/';
	if ( path === '/index.html' ) return '/';
	if ( path.endsWith( '/index.html' ) ) return path.slice( 0, -'index.html'.length );
	if ( /\.[a-z0-9]+$/i.test( path ) ) return path;
	return path.endsWith( '/' ) ? path : `${ path }/`;
}

/**
 * Route in the copy → the source URL it was captured from.
 *
 * Only the receipt knows this mapping. A source captured at a subpath serves
 * its entrypoint as the copy's `/`, so resolving a route against the source
 * origin asks the live site for a page that was never captured — and a live
 * site is entitled to answer that with a 404 the comparison then treats as
 * the source of truth.
 */
export function routeSourceMap( receipt: CaptureReceipt ): Map< string, string > {
	const websiteRoot = ( receipt.websiteRoot ?? 'website' ).replace( /\\/g, '/' ).replace( /\/*$/, '' );
	const map = new Map< string, string >();
	for ( const route of receipt.routes ?? [] ) {
		if ( ! route?.url || ! route?.path ) continue;
		const path = route.path.replace( /\\/g, '/' );
		const relative =
			websiteRoot && path.startsWith( `${ websiteRoot }/` )
				? path.slice( websiteRoot.length + 1 )
				: path;
		map.set( canonicalRoutePath( `/${ relative.replace( /^\/*/, '' ) }` ), route.url );
	}
	return map;
}

export function resolveCheckDirectory( directory: string ): {
	websiteDir: string;
	receiptPath: string;
} {
	const absolute = resolve( directory );
	if ( ! existsSync( absolute ) || ! statSync( absolute ).isDirectory() ) {
		throw new Error( `Not a directory: ${ absolute }` );
	}
	const nestedReceipt = join( absolute, 'capture-receipt.json' );
	const nestedWebsite = join( absolute, 'website' );
	if ( existsSync( nestedReceipt ) && existsSync( nestedWebsite ) ) {
		return { websiteDir: nestedWebsite, receiptPath: nestedReceipt };
	}
	const parentReceipt = join( absolute, '..', 'capture-receipt.json' );
	if ( existsSync( parentReceipt ) ) {
		return { websiteDir: absolute, receiptPath: parentReceipt };
	}
	throw new Error(
		`No capture-receipt.json next to ${ absolute }. Point check at a liberated run directory.`
	);
}

export function checkWidthsFor( sampled: number[] = DEFAULT_SWEEP_WIDTHS ): number[] {
	return DEFAULT_CHECK_WIDTHS.filter( ( width ) => ! sampled.includes( width ) );
}

async function observePage(
	page: Page,
	url: string,
	viewport: number,
	settleMs: number,
	localOrigin: string | null
): Promise< LayoutObservation > {
	const external = new Set< string >();
	const onRequest = ( request: { url: () => string } ): void => {
		if ( ! localOrigin ) return;
		const href = request.url();
		if ( href.startsWith( 'data:' ) || href.startsWith( 'blob:' ) || href.startsWith( localOrigin ) ) return;
		try {
			external.add( new URL( href ).host );
		} catch {
			/* ignore unparseable */
		}
	};
	page.on( 'request', onRequest );
	try {
		await page.goto( url, { waitUntil: 'domcontentloaded', timeout: 60_000 } ).catch( () => {} );
		await page.waitForTimeout( settleMs );
		const measured = await page.evaluate( async ( clickUnresolved: boolean ) => {
			// Images that occupy real layout space at this viewport: wider and
			// taller than 50px (the same floor as widestImage) and not
			// visibility:hidden, so tracking pixels and hidden decorations add
			// no noise. opacity:0 is deliberately kept — a carousel's parked
			// slides are transparent yet still hold the slideshow's layout
			// box, and a copy that drops them all is exactly the regression
			// the image-count gate exists to catch.
			const images = [ ...document.querySelectorAll< HTMLImageElement >( 'img' ) ]
				.map( ( image ) => ( {
					rect: image.getBoundingClientRect(),
					src: image.currentSrc || image.getAttribute( 'src' ) || '',
					hidden: getComputedStyle( image ).visibility === 'hidden',
				} ) )
				.filter( ( { rect, hidden } ) => ! hidden && rect.width > 50 && rect.height > 50 )
				.map( ( { rect, src } ) => ( {
					key: src,
					x: Math.round( rect.x ),
					y: Math.round( rect.y ),
					width: Math.round( rect.width ),
					height: Math.round( rect.height ),
				} ) );

			const typography: Array< {
				key: string;
				fontFamily: string;
				fontWeight: string;
				fontSize: number;
				lineHeight: number;
				letterSpacing: number;
				advance: number;
				loaded: boolean;
			} > = [];
			const canvas = document.createElement( 'canvas' );
			const context = canvas.getContext( '2d' );
			const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
			let textNode: Node | null;
			while ( typography.length < 120 && ( textNode = walker.nextNode() ) ) {
				const parent = textNode.parentElement;
				const text = ( textNode.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
				if ( ! parent || ! text || parent.closest( 'script,style,noscript,template' ) ) continue;
				const range = document.createRange();
				range.selectNodeContents( textNode );
				const rect = range.getBoundingClientRect();
				const style = getComputedStyle( parent );
				if (
					rect.width <= 0 ||
					rect.height <= 0 ||
					style.display === 'none' ||
					style.visibility === 'hidden'
				) {
					continue;
				}
				const fontSize = Number.parseFloat( style.fontSize ) || 0;
				const font = `${ style.fontStyle } ${ style.fontWeight } ${ style.fontSize } ${ style.fontFamily }`;
				if ( context ) context.font = font;
				typography.push( {
					key: text.slice( 0, 120 ),
					fontFamily: style.fontFamily,
					fontWeight: style.fontWeight,
					fontSize,
					lineHeight: Number.parseFloat( style.lineHeight ) || fontSize * 1.2,
					letterSpacing: Number.parseFloat( style.letterSpacing ) || 0,
					advance: Math.round( ( context?.measureText( text ).width ?? rect.width ) * 100 ) / 100,
					loaded: document.fonts.check( font, text ),
				} );
			}

			const occurrencesBefore = new Map< string, number >();
			const animationsBefore = document
				.getAnimations()
				.filter( ( animation ) => animation.effect?.getComputedTiming().iterations !== Infinity )
				.map( ( animation ) => {
					const name = ( animation as Animation & { animationName?: string } ).animationName;
					if ( ! name || name === 'none' ) return null;
					const occurrence = occurrencesBefore.get( name ) ?? 0;
					occurrencesBefore.set( name, occurrence + 1 );
					return {
						key: `${ name }:${ occurrence }`,
						name,
						time: animation.currentTime?.toString() ?? 'null',
						state: animation.playState,
					};
				} )
				.filter( ( animation ): animation is NonNullable< typeof animation > => animation !== null );
			const animationStateBefore = new Map(
				animationsBefore.map( ( animation ) => [ animation.key, animation ] )
			);
			const originalScroll = { x: scrollX, y: scrollY };
			const root = document.documentElement;
			const scrollBehavior = root.style.scrollBehavior;
			root.style.scrollBehavior = 'auto';
			window.scrollTo( 0, Math.min( document.documentElement.scrollHeight - innerHeight, innerHeight * 1.5 ) );
			await new Promise( ( resolve ) => requestAnimationFrame( () => requestAnimationFrame( resolve ) ) );
			await new Promise( ( resolve ) => setTimeout( resolve, 250 ) );
			const occurrencesAfter = new Map< string, number >();
			const animationsAfter = document
				.getAnimations()
				.filter( ( animation ) => animation.effect?.getComputedTiming().iterations !== Infinity )
				.map( ( animation ) => {
					const name = ( animation as Animation & { animationName?: string } ).animationName;
					if ( ! name || name === 'none' ) return null;
					const occurrence = occurrencesAfter.get( name ) ?? 0;
					occurrencesAfter.set( name, occurrence + 1 );
					return {
						key: `${ name }:${ occurrence }`,
						name,
						time: animation.currentTime?.toString() ?? 'null',
						state: animation.playState,
					};
				} )
				.filter( ( animation ): animation is NonNullable< typeof animation > => animation !== null );
			const responsiveAnimations = animationsAfter
				.filter( ( animation ) => {
					const before = animationStateBefore.get( animation.key );
					return ! before || before.time !== animation.time || before.state !== animation.state;
				} )
				.map( ( animation ) => animation.name )
				.sort();
			window.scrollTo( originalScroll.x, originalScroll.y );
			root.style.scrollBehavior = scrollBehavior;
			const animations = animationsBefore.map( ( animation ) => animation.name ).sort();
			const hashTargets: { fragment: string; resolved: boolean; targets: number }[] = [];
			const internalPaths: string[] = [];
			const seen = new Set< string >();
			for ( const link of document.querySelectorAll< HTMLAnchorElement >( 'a[href]' ) ) {
				const href = link.getAttribute( 'href' ) ?? '';
				if ( ! href || href === '#' ) continue;
				let target: URL;
				try {
					target = new URL( href, location.href );
				} catch {
					continue;
				}
				if ( target.origin !== location.origin ) continue;
				if ( target.hash ) {
					let fragment: string;
					try {
						fragment = decodeURIComponent( target.hash.slice( 1 ) );
					} catch {
						continue;
					}
					if ( ! fragment || seen.has( `#${ fragment }` ) ) continue;
					seen.add( `#${ fragment }` );
					const targets = [ ...document.querySelectorAll( '[id],a[name]' ) ].filter(
						( element ) =>
							element.id === fragment || element.getAttribute( 'name' ) === fragment
					).length;
					hashTargets.push( { fragment, resolved: targets > 0, targets } );
				}
				if (
					target.pathname &&
					target.pathname !== location.pathname &&
					! seen.has( target.pathname )
				) {
					seen.add( target.pathname );
					internalPaths.push( target.pathname );
				}
			}

			if ( clickUnresolved ) {
				const original = { x: scrollX, y: scrollY };
				let clicks = 0;
				for ( const target of hashTargets ) {
					if ( target.resolved || clicks >= 8 ) continue;
					const trigger = [ ...document.querySelectorAll< HTMLAnchorElement >( 'a[href]' ) ].find(
						( link ) => {
							try {
								return (
									decodeURIComponent( new URL( link.href, location.href ).hash.slice( 1 ) ) ===
									target.fragment
								);
							} catch {
								return false;
							}
						}
					);
					if ( ! trigger || trigger.getClientRects().length === 0 ) continue;
					clicks++;
					trigger.click();
					let previous = scrollY;
					let stable = 0;
					for ( let attempt = 0; attempt < 40 && stable < 4; attempt++ ) {
						await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
						if ( Math.abs( scrollY - previous ) < 1 ) stable++;
						else stable = 0;
						previous = scrollY;
					}
					if ( Math.abs( scrollY - original.y ) > 4 ) target.resolved = true;
					const root = document.documentElement;
					const behavior = root.style.scrollBehavior;
					root.style.scrollBehavior = 'auto';
					window.scrollTo( original.x, original.y );
					root.style.scrollBehavior = behavior;
				}
			}

			return {
				title: document.title,
				textChars: ( document.body?.innerText ?? '' ).replace( /\s+/g, ' ' ).trim().length,
				widestImage: images.length
					? Math.max( ...images.map( ( image ) => image.width ) )
					: null,
				images,
				typography,
				animations,
				responsiveAnimations,
				docWidth: document.documentElement.scrollWidth,
				overflow: document.documentElement.scrollWidth > window.innerWidth,
				hashTargets,
				internalPaths,
			};
		}, ! localOrigin );

		const internalMissing: string[] = [];
		if ( localOrigin ) {
			for ( const path of measured.internalPaths.slice( 0, MAX_ROUTE_CHECKS ) ) {
				const response = await page.request.get( `${ localOrigin }${ path }`, { timeout: 10_000 } );
				if ( ! response.ok() ) internalMissing.push( path );
			}
		}

		const dialogs = ( await page.evaluate( `(async () => {
			const isShown = (element) => {
				const rect = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
			};
			const openCount = () =>
				[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].filter(isShown).length;
			const triggers = [...document.querySelectorAll('button,a[aria-haspopup],summary,[aria-expanded]')]
				.filter((element) => {
					if (!isShown(element)) return false;
					if (element.getAttribute('aria-disabled') === 'true') return false;
					const href = element.tagName === 'A' ? (element.getAttribute('href') || '').trim() : '';
					if (href && href !== '#' && !href.startsWith('#')) return false;
					if (element.tagName === 'SUMMARY') return true;
					if (element.hasAttribute('aria-expanded')) return true;
					const popup = (element.getAttribute('aria-haspopup') || '').toLowerCase();
					if (['dialog', 'menu', 'true'].includes(popup)) return true;
					const label = (element.getAttribute('aria-label') || element.innerText || '').toLowerCase();
					return element.tagName === 'BUTTON' && /\\bmenu\\b/.test(label);
				})
				.slice(0, 8);
			const probes = [];
			for (const trigger of triggers) {
				const label = (trigger.getAttribute('aria-label') || trigger.innerText || 'dialog').replace(/\\s+/g, ' ').trim().slice(0, 40);
				const before = openCount();
				const expanded = trigger.getAttribute('aria-expanded') === 'true';
				const bodyClass = document.body.className;
				const hidden = [...document.querySelectorAll('[aria-hidden="true"]')];
				trigger.click();
				await new Promise((resolve) => setTimeout(resolve, 400));
				const details = trigger.closest('details');
				const revealed = hidden.some((element) => element.getAttribute('aria-hidden') !== 'true');
				const opened =
					openCount() > before ||
					(trigger.getAttribute('aria-expanded') === 'true' && !expanded) ||
					Boolean(details && details.open) ||
					revealed ||
					document.body.className !== bodyClass;
				probes.push({ label: label || 'dialog', opened });
				document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
				if (details && details.open) details.open = false;
				await new Promise((resolve) => setTimeout(resolve, 150));
			}
			return probes;
		})()` ) ) as DialogProbe[];

		return {
			viewport,
			title: measured.title,
			textChars: measured.textChars,
			widestImage: measured.widestImage,
			images: measured.images.map( ( image ) => ( {
				...image,
				key: normalizeImageKey( image.key ),
			} ) ),
			typography: measured.typography,
			animations: measured.animations,
			responsiveAnimations: measured.responsiveAnimations,
			docWidth: measured.docWidth,
			overflow: measured.overflow,
			externalHosts: [ ...external ].sort(),
			hashTargets: measured.hashTargets as HashTarget[],
			internalMissing,
			dialogs,
		};
	} finally {
		page.off( 'request', onRequest );
	}
}

export async function checkFidelity( options: FidelityCheckOptions ): Promise< FidelityReport > {
	const log = options.log ?? ( () => {} );
	const { websiteDir, receiptPath } = resolveCheckDirectory( options.directory );
	const receipt = JSON.parse( readFileSync( receiptPath, 'utf8' ) ) as CaptureReceipt;
	const sourceUrl = receipt.source?.url;
	if ( ! sourceUrl ) throw new Error( `capture-receipt.json has no source.url: ${ receiptPath }` );

	const widths = options.widths ?? checkWidthsFor();
	const settleMs = options.settleMs ?? 4000;

	const sources = routeSourceMap( receipt );
	if ( ! sources.has( '/' ) ) sources.set( '/', sourceUrl );

	const captured = [ ...sources.keys() ].sort( ( left, right ) =>
		left === '/' ? -1 : right === '/' ? 1 : left.localeCompare( right )
	);
	const requested = options.routes?.map( canonicalRoutePath );
	for ( const route of requested ?? [] ) {
		if ( sources.has( route ) ) continue;
		throw new Error(
			`Route ${ route } was not captured. Captured routes: ${ captured.join( ', ' ) }`
		);
	}

	// Tier one: every route, offline. Anchors, internal links and stray remote
	// assets are pure functions of what is on disk, so there is no reason to
	// sample them.
	const selfConsistency = checkSelfConsistency( websiteDir, routeFiles( receipt ) );
	log(
		`[compare] self-consistency: ${ selfConsistency.routes } route(s), ${ selfConsistency.findings.length } finding(s)`
	);

	// Tier two: the live source, which costs a browser round trip per check, so
	// it runs on a bounded sample. The entrypoint always leads; the rest are
	// spread across the route list rather than taken in order, since ordered
	// selection on a blog spends the whole budget inside /blog/.
	const routes = requested ?? spreadSample( captured, options.sampleSize ?? BROWSER_ROUTE_SAMPLE );
	if ( ! requested && routes.length < captured.length ) {
		log( `[compare] source fidelity: sampling ${ routes.length } of ${ captured.length } route(s)` );
	}

	let observe = options.observe;
	const server = observe ? null : await startStaticServer( websiteDir );
	const browser = observe ? null : await chromium.launch();
	const page = browser ? await browser.newPage() : null;
	if ( ! observe ) {
		observe = async ( sourceHref, localHref, viewport ) => {
			if ( ! page ) throw new Error( 'browser page missing' );
			await page.setViewportSize( { width: viewport, height: 900 } );
			const source = await observePage( page, sourceHref, viewport, settleMs, null );
			const sourcePng = options.screenshots ? await page.screenshot() : undefined;
			const liberated = await observePage(
				page,
				localHref,
				viewport,
				settleMs,
				new URL( localHref ).origin
			);
			const liberatedPng = options.screenshots ? await page.screenshot() : undefined;
			return { source, liberated, sourcePng, liberatedPng };
		};
	}

	const scores: RouteScore[] = [];
	try {
		for ( const route of routes ) {
			const sourceHref = sources.get( route )!;
			const localHref = `${ server?.url ?? 'http://liberated.invalid' }${ route }`;
			for ( const width of widths ) {
				log( `[compare] ${ route } @ ${ width }px` );
				const pair = await observe( sourceHref, localHref, width );
				const evidenceDir = join(
					dirname( receiptPath ),
					'compare',
					evidenceSlug( route ),
					String( width )
				);
				// Every check, built-in and contributed, runs through the registry.
				const checked = await runFidelityChecks( {
					route,
					viewport: width,
					sourceUrl: sourceHref,
					candidateUrl: localHref,
					source: pair.source,
					candidate: pair.liberated,
					evidenceDir,
				} );
				const score: RouteScore = {
					route,
					viewport: width,
					pass: checked.failures.length === 0,
					failures: checked.failures,
					notes: checked.notes,
					source: pair.source,
					liberated: pair.liberated,
				};
				for ( const artifact of checked.artifacts ) score.notes.push( `evidence → ${ artifact }` );
				if ( pair.sourcePng && pair.liberatedPng ) {
					const evidence = writePixelEvidence( evidenceDir, pair.sourcePng, pair.liberatedPng );
					if ( 'score' in evidence ) {
						score.notes.push(
							`pixel ${ evidence.score.toFixed( 4 ) } (evidence, not a gate) → ${ evidence.diffPath }`
						);
					} else {
						score.notes.push( evidence.error );
					}
				}
				scores.push( score );
			}
			// The interactivity pass deliberately does not run the check registry.
			// It blanks every field except dialogs so that one narrow question can
			// be asked at a width the layout comparison does not cover, and handing
			// a contributed check a synthetic observation would invite it to draw
			// conclusions from values that were zeroed rather than measured.
			if ( ! widths.includes( 390 ) ) {
				log( `[compare] ${ route } @ 390px interactivity` );
				const pair = await observe( sourceHref, localHref, 390 );
				const dialogOnly = ( observation: LayoutObservation ): LayoutObservation => ( {
					...observation,
					title: 'x',
					textChars: 0,
					widestImage: null,
					images: [],
					overflow: false,
					docWidth: 390,
					externalHosts: [],
					hashTargets: [],
					internalMissing: [],
				} );
				const score = {
					...scoreViewport( dialogOnly( pair.source ), dialogOnly( pair.liberated ) ),
					route,
				};
				score.notes.push( 'interactivity' );
				scores.push( score );
			}
		}
	} finally {
		await browser?.close();
		await server?.close();
	}

	const summary = scoreReport( scores );
	summary.pass = summary.pass && selfConsistency.pass;
	return {
		sourceUrl,
		websiteDir,
		widths,
		routes,
		routesAvailable: captured.length,
		selfConsistency,
		scores,
		...summary,
	};
}
