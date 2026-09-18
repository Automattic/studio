// src/adapters/wix/capture.ts
//
// Wix-specific capture knowledge. None of this belongs in the shared capture
// path: recognising a platform's CDN is exactly what an adapter is for.
//
import type { LiberationHooks } from '../page-actions.js';
import { providerCreditRules } from '../../lib/source-cleanup.js';
import type { Locator, Page } from 'playwright';

/** Wix media ids look like `8e80e7_a1b2…`, stable across crops of one asset. */
const WIX_MEDIA_ID = /([a-z0-9]{4,12}_[a-z0-9]{24,48})/i;
/** Only `/fill/w_,h_` URLs are the runtime-swapped per-viewport crops. */
const WIX_FILL_VARIANT = /static\.wixstatic\.com\/.+\/fill\/w_\d+,h_\d+/;

/**
 * Recognise a Wix responsive image variant, returning its stable media id and
 * the variant URL.
 *
 * Pure, so the URL shape this depends on is testable without a browser.
 */
export function wixStaticMediaUrl(
	uri: string,
	size?: { width: number; height: number }
): string {
	if ( /^https?:/i.test( uri ) ) return uri;
	if ( ! size ) return `https://static.wixstatic.com/media/${ uri }`;
	const file = uri.split( '/' ).pop() || uri;
	return `https://static.wixstatic.com/media/${ uri }/v1/fill/w_${ Math.max( 1, Math.round( size.width ) ) },h_${ Math.max( 1, Math.round( size.height ) ) },al_c,q_85,enc_avif,quality_auto/${ file }`;
}

function escapeAttr( value: string ): string {
	return value.replace( /&/g, '&amp;' ).replace( /"/g, '&quot;' ).replace( /</g, '&lt;' );
}

export function stripShowcaseMarkup(
	items: Array< { uri: string; alt?: string; title?: string } >,
	size: { width: number; height: number }
): { html: string; css: string } {
	const count = Math.max( items.length, 1 );
	const height = Math.max( 1, Math.round( size.height ) );
	const width = Math.max( 1, Math.round( size.width ) );
	const imgs = items
		.map( ( item ) => {
			const alt = escapeAttr( item.alt || item.title || '' );
			return `<img src="${ escapeAttr( wixStaticMediaUrl( item.uri, { width, height } ) ) }" alt="${ alt }">`;
		} )
		.join( '' );
	const html = `<div class="dla-slideshow"><div class="dla-slideshow-track">${ imgs }</div></div>`;
	const step = 100 / count;
	const hold = step * 0.8;
	let frames = '';
	for ( let index = 0; index < count; index++ ) {
		const start = index * step;
		frames += `${ start }%{transform:translateX(-${ index * 100 }%)}`;
		frames += `${ start + hold }%{transform:translateX(-${ index * 100 }%)}`;
	}
	frames += '100%{transform:translateX(0)}';
	const css =
		'.dla-slideshow{overflow:hidden;width:100%;height:100%;position:relative}' +
		`.dla-slideshow-track{display:flex;height:100%;animation:dla-slideshow ${ count * 2 }s infinite}` +
		'.dla-slideshow-track img{flex:0 0 100%;width:100%;height:100%;object-fit:cover}' +
		`@keyframes dla-slideshow{${ frames }}` +
		'@media (prefers-reduced-motion:reduce){.dla-slideshow{overflow-x:auto;scroll-snap-type:x mandatory}.dla-slideshow-track{animation:none}.dla-slideshow-track img{scroll-snap-align:start}}';
	return { html, css };
}

export function wixMediaVariant( url: string ): { id: string; url: string } | null {
	if ( ! WIX_FILL_VARIANT.test( url ) ) return null;
	const match = WIX_MEDIA_ID.exec( url );
	return match ? { id: match[ 1 ]!.toLowerCase(), url } : null;
}

export const WIX_CAPTURE_CHROME_SELECTOR =
	'[id="WIX_ADS"], [id$="-hiddenA11ySubMenuIndication"], [id$="__more__"]';

const WIX_SLIDESHOW_SELECTOR = '.wixui-slideshow';
const WIX_SLIDESHOW_LIMIT = 4;
const WIX_SLIDE_LIMIT = 6;
const WIX_SLIDE_SETTLE_MILLISECONDS = 10_000;
const WIX_SLIDE_POLL_MILLISECONDS = 100;

/**
 * Wix mounts only the active slide. Replace that transient state with the
 * distinct states observed through its authored next control before serializing.
 */
export function preserveWixSlideshowSlides(
	{ slideshowIndex, slides }: { slideshowIndex: number; slides: string[] }
): void {
	const slideshow = document.querySelectorAll< HTMLElement >( '.wixui-slideshow' )[ slideshowIndex ];
	const wrapper = slideshow?.querySelector< HTMLElement >( '[data-testid="slidesWrapper"]' );
	if ( ! slideshow || ! wrapper || slides.length < 2 ) return;

	const fragment = document.createDocumentFragment();
	for ( const [ index, html ] of slides.entries() ) {
		const template = document.createElement( 'template' );
		template.innerHTML = html;
		const slide = template.content.firstElementChild;
		if ( ! slide ) continue;
		slide.setAttribute( 'data-dla-captured-slide', String( index ) );
		fragment.append( slide );
	}
	if ( fragment.childElementCount < 2 ) return;

	wrapper.replaceChildren( fragment );
	slideshow.dataset.dlaCapturedSlideshow = 'true';
	if ( ! document.getElementById( 'dla-wix-captured-slideshow-css' ) ) {
		const style = document.createElement( 'style' );
		style.id = 'dla-wix-captured-slideshow-css';
		style.textContent =
			'.wixui-slideshow[data-dla-captured-slideshow="true"] [data-testid="slidesWrapper"]>[data-dla-captured-slide]{display:none!important}' +
			'.wixui-slideshow[data-dla-captured-slideshow="true"] [data-testid="slidesWrapper"]>[data-dla-captured-slide="0"]{display:block!important}';
		document.head.append( style );
	}
}

function snapshotWixSlide(
	page: Page,
	slideshowIndex: number
): Promise< { html: string; key: string } | null > {
	return page.evaluate( ( index ) => {
		const slideshow = document.querySelectorAll< HTMLElement >( '.wixui-slideshow' )[ index ];
		const slide = slideshow?.querySelector< HTMLElement >( '[data-testid="slidesWrapper"] > *' );
		if ( ! slide ) return null;
		const media = [ ...slide.querySelectorAll< HTMLImageElement >( 'img' ) ].map(
			( image ) => image.currentSrc || image.src
		);
		const drawings = [ ...slide.querySelectorAll( 'svg' ) ].map( ( node ) => node.innerHTML );
		const text = slide.textContent?.replace( /\s+/g, ' ' ).trim() ?? '';
		return {
			html: slide.outerHTML,
			key: `${ text }\n${ media.join( '\n' ) }\n${ drawings.join( '\n' ) }`,
		};
	}, slideshowIndex );
}

function slideshowExpectedStateCount( page: Page, slideshowIndex: number ): Promise< number | null > {
	return page.evaluate( ( index ) => {
		const slideshow = document.querySelectorAll< HTMLElement >( '.wixui-slideshow' )[ index ];
		const controls = slideshow?.querySelectorAll( 'nav[aria-label] a[href]' ) ?? [];
		const destinations = new Set(
			[ ...controls ]
				.map( ( control ) => control.getAttribute( 'href' ) ?? '' )
				.filter( Boolean )
		);
		return destinations.size || null;
	}, slideshowIndex );
}

async function waitForWixSlideChange(
	page: Page,
	slideshowIndex: number,
	previousKey: string
): Promise< { html: string; key: string } | null > {
	for ( let elapsed = 0; elapsed < WIX_SLIDE_SETTLE_MILLISECONDS; elapsed += WIX_SLIDE_POLL_MILLISECONDS ) {
		await page.waitForTimeout( WIX_SLIDE_POLL_MILLISECONDS );
		const snapshot = await snapshotWixSlide( page, slideshowIndex );
		if ( snapshot && snapshot.key !== previousKey ) return snapshot;
	}
	return null;
}

export async function collectWixSlideshowSlides( page: Page ): Promise< void > {
	const count = await page.locator( WIX_SLIDESHOW_SELECTOR ).count();
	for ( let slideshowIndex = 0; slideshowIndex < Math.min( count, WIX_SLIDESHOW_LIMIT ); slideshowIndex++ ) {
		const slideshow = page.locator( WIX_SLIDESHOW_SELECTOR ).nth( slideshowIndex );
		const next = slideshow.locator( 'button[data-testid="nextButton"]' );
		if ( await next.count() !== 1 ) continue;
		await slideshow.scrollIntoViewIfNeeded?.();

		const initial = await snapshotWixSlide( page, slideshowIndex );
		if ( ! initial ) continue;
		const expected = await slideshowExpectedStateCount( page, slideshowIndex );
		const slides = [ initial ];
		const seen = new Set( [ initial.key ] );
		let failure = '';
		const controls: Locator[] = [ next ];
		const previous = slideshow.locator( 'button[data-testid="prevButton"]' );
		if ( await previous.count() === 1 ) controls.push( previous );
		const dots = slideshow.locator( 'nav[aria-label] a[href]' );
		for ( let index = 0; index < Math.min( await dots.count(), WIX_SLIDE_LIMIT - 1 ); index++ ) {
			controls.push( dots.nth( index ) );
		}
		for ( const control of controls ) {
			try {
				await control.click();
			} catch ( error ) {
				failure ||= `slideshow control could not be activated: ${ error instanceof Error ? error.message : String( error ) }`;
				continue;
			}
			const snapshot = await waitForWixSlideChange( page, slideshowIndex, slides.at( -1 )!.key );
			if ( ! snapshot ) {
				continue;
			}
			if ( seen.has( snapshot.key ) ) continue;
			seen.add( snapshot.key );
			slides.push( snapshot );
			if ( expected !== null && slides.length >= expected ) break;
		}

		if ( expected !== null && slides.length !== expected ) {
			failure ||= `observed ${ slides.length } of ${ expected } states declared by slideshow navigation`;
		}
		if ( slides.length > 1 ) {
			await page.evaluate( preserveWixSlideshowSlides, {
				slideshowIndex,
				slides: slides.map( ( slide ) => slide.html ),
			} );
			continue;
		}
		await page.evaluate( ( { index, message, observed, expectedStates } ) => {
			const slideshow = document.querySelectorAll< HTMLElement >( '.wixui-slideshow' )[ index ];
			if ( ! slideshow ) return;
			slideshow.dataset.dlaCapturedSlideshow = 'false';
			slideshow.dataset.dlaCapturedSlideCount = String( observed );
			if ( expectedStates !== null ) slideshow.dataset.dlaExpectedSlideCount = String( expectedStates );
			slideshow.dataset.dlaCaptureError = message || 'fewer than two distinct slideshow states observed';
		}, { index: slideshowIndex, message: failure, observed: slides.length, expectedStates: expected } );
	}
}

/**
 * Wix creates an overflow item and a mobile drawer only after its client
 * runtime starts. A portable capture cannot retain that runtime, so settle the
 * live menu into a static list of its authored destinations instead.
 */
export async function settleWixNavigation( viewport: 'desktop' | 'mobile' ): Promise< void > {
	const waitForFrame = () =>
		new Promise< void >( ( resolve ) =>
			requestAnimationFrame( () => requestAnimationFrame( () => resolve() ) )
		);
	const visible = ( element: Element ) => {
		const rect = element.getBoundingClientRect();
		const style = getComputedStyle( element );
		return (
			rect.width > 0 &&
			rect.height > 0 &&
			style.display !== 'none' &&
			style.visibility !== 'hidden'
		);
	};
	const reveal = ( list: Element ) => {
		for ( const item of list.querySelectorAll< HTMLElement >( ':scope > li' ) ) {
			if ( ! item.querySelector( 'a[href]' ) ) continue;
			item.removeAttribute( 'aria-hidden' );
			for ( const property of [
				'display',
				'visibility',
				'opacity',
				'height',
				'max-height',
				'overflow',
				'position',
			] ) {
				item.style.removeProperty( property );
			}
			for ( const descendant of item.querySelectorAll< HTMLElement >( '[tabindex="-1"]' ) )
				descendant.removeAttribute( 'tabindex' );
		}
	};

	if ( viewport === 'mobile' ) {
		const toggle = document.querySelector< HTMLElement >( '#MENU_AS_CONTAINER_TOGGLE' );
		if ( toggle && visible( toggle ) ) {
			toggle.click();
			await waitForFrame();
			// Retain the authored trigger so conversion can emit responsive navigation.
		}
		const lists = Array.from( document.querySelectorAll( 'header ul' ) );
		lists.sort(
			( left, right ) =>
				right.querySelectorAll( 'a[href]' ).length - left.querySelectorAll( 'a[href]' ).length
		);
		if ( lists[ 0 ] ) reveal( lists[ 0 ] );
		return;
	}

	const more = Array.from( document.querySelectorAll< HTMLElement >( 'li[id$="__more__"]' ) ).find(
		visible
	);
	if ( ! more ) return;
	const list = more.parentElement;
	const trigger = more.querySelector< HTMLElement >( '[data-testid="linkElement"]' ) ?? more;
	trigger.click();
	await waitForFrame();
	if ( list ) reveal( list );
	more.remove();
}

async function revealAndCollectWixSlideshows( page: Page ): Promise< void > {
	for ( let pass = 0; pass < 3; pass++ ) {
		await page
			.evaluate( async () => {
				const step = 600;
				const max = Math.min( document.documentElement.scrollHeight, 12_000 );
				for ( let y = 0; y <= max; y += step ) {
					window.scrollTo( { top: y, left: 0, behavior: 'instant' } );
					await new Promise( ( resolve ) => setTimeout( resolve, 80 ) );
				}
				window.scrollTo( { top: 0, left: 0, behavior: 'instant' } );
			} )
			.catch( () => undefined );
		const count = await page.locator( WIX_SLIDESHOW_SELECTOR ).count().catch( () => 0 );
		if ( count > 0 ) break;
		await page.waitForTimeout( 2_000 );
	}
	await collectWixSlideshowSlides( page );
}

/**
 * Return the document to its at-top state after capture-time scrolling.
 *
 * A builder hides or compresses a sticky header while the reader scrolls, and
 * it recomputes that state on a scroll EVENT rather than on position alone. A
 * bare restore therefore leaves the hidden-state class on the header, and the
 * freeze records a page whose header is translated out of view. Scroll to the
 * top, tell the handler, then let its transition run back.
 */
export async function settleScrollReactiveChrome( page: Page ): Promise< void > {
	await page
		.evaluate( () => {
			const root = document.documentElement;
			const behavior = root.style.scrollBehavior;
			root.style.scrollBehavior = 'auto';
			window.scrollTo( { top: 0, left: 0, behavior: 'instant' } );
			root.style.scrollBehavior = behavior;
			window.dispatchEvent( new Event( 'scroll' ) );
		} )
		.catch( () => undefined );
	// The handler is throttled, so its transition starts a beat after the event.
	await page.waitForTimeout( 400 );
	await page
		.evaluate( async () => {
			// Ambient motion such as a spinner never finishes, so each wait is
			// bounded and the restore transition is the only thing worth awaiting.
			const settled = document.getAnimations().map( ( animation ) =>
				Promise.race( [
					animation.finished.catch( () => undefined ),
					new Promise( ( resolve ) => setTimeout( resolve, 600 ) ),
				] )
			);
			await Promise.all( settled );
		} )
		.catch( () => undefined );
}

export const capture: LiberationHooks = {
  cleanupRules: [
    { id: 'wix-free-banner', category: 'source-attribution', selector: '#WIX_ADS' },
    ...providerCreditRules('wix', ['wix.com'], 'Wix'),
  ],
	removeSelectors: [ '[id="WIX_ADS"]', '[id$="-hiddenA11ySubMenuIndication"]' ],
	/**
	 * Wix resolves same-page anchors in its click runtime rather than with
	 * authored `id` targets, so a captured copy has nowhere to scroll to once
	 * that runtime is stripped. Observe where the live page settles for each
	 * fragment and leave a real target behind.
	 */
	prepare: async ( page, ctx ) => {
		await page.evaluate( settleWixNavigation, ctx.viewport );
		await page.evaluate( async ( chromeSelector ) => {
			for ( const chrome of document.querySelectorAll( chromeSelector ) ) chrome.remove();

			const linksByFragment = new Map< string, HTMLAnchorElement[] >();
			for ( const link of document.querySelectorAll< HTMLAnchorElement >( 'a[href]' ) ) {
				let target: URL;
				try {
					target = new URL( link.href, location.href );
				} catch {
					continue;
				}
				if ( target.origin !== location.origin || target.pathname !== location.pathname )
					continue;

				const declaredIntent = link.getAttribute( 'data-anchor' ) ?? '';
				const encodedFragment = target.hash ? target.hash.slice( 1 ) : declaredIntent;
				if ( ! encodedFragment ) continue;
				let fragment: string;
				try {
					fragment = decodeURIComponent( encodedFragment );
				} catch {
					continue;
				}
				// eslint-disable-next-line no-control-regex -- fragment IDs must not carry controls.
				if ( ! fragment || fragment.length > 128 || /[\u0000-\u001f\u007f]/.test( fragment ) )
					continue;
				link.dataset.dlaAnchorFragment = fragment;
				linksByFragment.set( fragment, [ ...( linksByFragment.get( fragment ) ?? [] ), link ] );
			}

			const originalScroll = { x: scrollX, y: scrollY };
			const waitForScroll = async (): Promise< void > => {
				let previous = scrollY;
				let stableFrames = 0;
				for ( let attempt = 0; attempt < 40 && stableFrames < 4; attempt++ ) {
					await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
					if ( Math.abs( scrollY - previous ) < 1 ) stableFrames++;
					else stableFrames = 0;
					previous = scrollY;
				}
			};
			const markUnresolved = ( links: HTMLAnchorElement[], reason: string ) => {
				for ( const link of links ) link.dataset.dlaAnchorUnresolved = reason;
			};

			let resolvedFragments = 0;
			for ( const [ fragment, links ] of linksByFragment ) {
				if ( resolvedFragments >= 32 ) {
					markUnresolved( links, 'runtime fragment target limit reached' );
					continue;
				}
				resolvedFragments++;
				const authoredTargets = [
					...document.querySelectorAll< HTMLElement >( '[id],a[name]' ),
				].filter(
					( element ) => element.id === fragment || element.getAttribute( 'name' ) === fragment
				);
				if ( authoredTargets.length === 1 ) {
					authoredTargets[ 0 ]!.dataset.dlaAnchorTarget = fragment;
					for ( const link of links ) link.href = `${ location.pathname }#${ encodeURIComponent( fragment ) }`;
					continue;
				}
				if ( authoredTargets.length > 1 ) {
					markUnresolved( links, 'multiple authored fragment targets' );
					continue;
				}

				const trigger = links.find( ( link ) => link.getClientRects().length > 0 );
				if ( ! trigger ) {
					markUnresolved( links, 'no rendered fragment trigger' );
					continue;
				}
				// Wix resolves named anchors in its click runtime, so observe the
				// resulting settled section boundary before provider scripts are removed.
				trigger.click();
				await waitForScroll();

				const targetTop = scrollY;
				const candidates = [
					...document.querySelectorAll< HTMLElement >(
						'section,article,main,footer,[role="region"],[role="contentinfo"],[data-testid="section-container"]'
					),
				]
					.filter( ( element ) => element.getClientRects().length > 0 )
					.map( ( element ) => ( {
						element,
						top: element.getBoundingClientRect().top + scrollY,
					} ) )
					.sort(
						( left, right ) => Math.abs( left.top - targetTop ) - Math.abs( right.top - targetTop )
					);
				const resolved = candidates[ 0 ];
				const headerOffset = document.querySelector< HTMLElement >( 'header' )?.getBoundingClientRect().height ?? 0;
				if ( ! resolved || Math.abs( resolved.top - targetTop ) > Math.max( 4, Math.ceil( headerOffset ) + 8 ) ) {
					markUnresolved( links, 'runtime scroll did not resolve to a section boundary' );
					continue;
				}

				const marker = document.createElement( 'span' );
				marker.id = fragment;
				marker.dataset.dlaAnchorTarget = fragment;
				if ( resolved.element.id ) marker.dataset.dlaAnchorSourceId = resolved.element.id;
				marker.setAttribute( 'aria-hidden', 'true' );
				marker.style.cssText = `position:absolute;top:${ Math.round(
					resolved.top
				) }px;left:0;width:0;height:0;overflow:hidden;pointer-events:none`;
				document.body.prepend( marker );
				for ( const link of links ) link.href = `${ location.pathname }#${ encodeURIComponent( fragment ) }`;
			}

			const root = document.documentElement;
			const scrollBehavior = root.style.scrollBehavior;
			root.style.scrollBehavior = 'auto';
			window.scrollTo( originalScroll.x, originalScroll.y );
			root.style.scrollBehavior = scrollBehavior;
		}, WIX_CAPTURE_CHROME_SELECTOR );

		const galleries = await page.evaluate( async () => {
			const urls = [
				...new Set(
					performance
						.getEntriesByType( 'resource' )
						.map( ( entry ) => entry.name )
						.filter( ( name ) => name.includes( '/pages/thunderbolt' ) )
				),
			];
			const itemsByComp: Record< string, Array< { uri: string; alt?: string; title?: string } > > =
				{};
			for ( const url of urls ) {
				try {
					const data = ( await ( await fetch( url ) ).json() ) as {
						props?: { tpa?: { tpaGalleriesImageItems?: Record< string, unknown > } };
					};
					const items = data.props?.tpa?.tpaGalleriesImageItems;
					if ( ! items ) continue;
					for ( const [ id, value ] of Object.entries( items ) ) {
						if ( ! Array.isArray( value ) ) continue;
						itemsByComp[ id ] = value.flatMap( ( entry ) => {
							if ( ! entry || typeof entry !== 'object' ) return [];
							const uri = ( entry as { uri?: unknown } ).uri;
							if ( typeof uri !== 'string' || ! uri ) return [];
							const alt = ( entry as { alt?: unknown } ).alt;
							const title = ( entry as { title?: unknown } ).title;
							return [
								{
									uri,
									...( typeof alt === 'string' ? { alt } : {} ),
									...( typeof title === 'string' ? { title } : {} ),
								},
							];
						} );
					}
				} catch {
					/* thunderbolt payloads that are not gallery JSON are ignored */
				}
			}
			return itemsByComp;
		} );

		for ( const [ id, items ] of Object.entries( galleries ) ) {
			if ( items.length === 0 ) continue;
			const size = await page.evaluate( ( compId: string ) => {
				const host = document.getElementById( compId );
				if ( ! host ) return { width: 1340, height: 486 };
				const box = host.getBoundingClientRect();
				return {
					width: Math.max( 1, Math.round( box.width ) ),
					height: Math.max( 1, Math.round( box.height ) ),
				};
			}, id );
			const { html, css } = stripShowcaseMarkup( items, size );
			await page.evaluate(
				( { compId, markup, stylesheet } ) => {
					const host = document.getElementById( compId );
					if ( ! host ) return;
					if ( ! document.getElementById( 'dla-slideshow-css' ) ) {
						const style = document.createElement( 'style' );
						style.id = 'dla-slideshow-css';
						style.textContent = stylesheet;
						document.head.append( style );
					}
					const wrap = document.createElement( 'div' );
					wrap.innerHTML = markup;
					const slideshow = wrap.firstElementChild;
					if ( ! slideshow ) return;
					const frame = host.querySelector( 'iframe, wix-iframe' );
					if ( frame ) frame.replaceWith( slideshow );
					else host.replaceChildren( slideshow );
				},
				{ compId: id, markup: html, stylesheet: css }
			);
		}
	},

	/**
	 * Fluid learning resizes the page after prepare. Collect slideshows on the
	 * DOM that is about to be frozen so a late-hydrated widget is not lost.
	 */
	beforeSerialize: async ( page ) => {
		await revealAndCollectWixSlideshows( page );
		// Revealing a slideshow scrolls, so the chrome is settled last of all.
		await settleScrollReactiveChrome( page );
	},

	/**
	 * At narrow viewports Wix's `<wow-image>` runtime swaps each image for a
	 * mobile-cropped CDN variant. Recording {media id → variant URL} lets the
	 * export serve that crop via `<picture>` with no JavaScript.
	 */
	async responsiveImages( page ) {
		// The browser step stays generic — read the URLs the runtime settled on.
		// Deciding which are Wix variants happens here, where it can be tested.
		const urls = await page.evaluate( () =>
			[ ...document.querySelectorAll( 'img' ) ].map(
				( image ) => ( image as HTMLImageElement ).currentSrc || ( image as HTMLImageElement ).src || ''
			)
		);
		const variants: Record< string, string > = {};
		for ( const url of urls ) {
			const variant = wixMediaVariant( url );
			if ( variant ) variants[ variant.id ] = variant.url;
		}
		return variants;
	},
};
