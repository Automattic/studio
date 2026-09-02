// src/adapters/wix/capture.ts
//
// Wix-specific capture knowledge. None of this belongs in the shared capture
// path: recognising a platform's CDN is exactly what an adapter is for.
//
import type { AdapterCapture } from '../page-actions.js';

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

export const capture: AdapterCapture = {
	/**
	 * Wix resolves same-page anchors in its click runtime rather than with
	 * authored `id` targets, so a captured copy has nowhere to scroll to once
	 * that runtime is stripped. Observe where the live page settles for each
	 * fragment and leave a real target behind.
	 */
	prepare: async ( page ) => {
		await page.evaluate( async () => {
			for ( const chrome of document.querySelectorAll(
				'[id="WIX_ADS"], [id$="-hiddenA11ySubMenuIndication"]'
			) )
				chrome.remove();

			const linksByFragment = new Map< string, HTMLAnchorElement[] >();
			for ( const link of document.querySelectorAll< HTMLAnchorElement >( 'a[href]' ) ) {
				let target: URL;
				try {
					target = new URL( link.href, location.href );
				} catch {
					continue;
				}
				if (
					target.origin !== location.origin ||
					target.pathname !== location.pathname ||
					! target.hash
				)
					continue;

				let fragment: string;
				try {
					fragment = decodeURIComponent( target.hash.slice( 1 ) );
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
						'section,article,main,[role="region"],[data-testid="section-container"]'
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
				if ( ! resolved || Math.abs( resolved.top - targetTop ) > 4 ) {
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
			}

			const root = document.documentElement;
			const scrollBehavior = root.style.scrollBehavior;
			root.style.scrollBehavior = 'auto';
			window.scrollTo( originalScroll.x, originalScroll.y );
			root.style.scrollBehavior = scrollBehavior;
		} );

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
