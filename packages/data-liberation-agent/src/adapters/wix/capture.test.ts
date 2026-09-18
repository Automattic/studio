import { load } from 'cheerio';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	capture,
	collectWixSlideshowSlides,
	preserveWixSlideshowSlides,
	settleScrollReactiveChrome,
	settleWixNavigation,
	stripShowcaseMarkup,
	wixMediaVariant,
	wixStaticMediaUrl,
	WIX_CAPTURE_CHROME_SELECTOR,
} from './capture.js';
import { wixAdapter } from './index.js';

const variant =
	'https://static.wixstatic.com/media/8e80e7_e9cc2e6993d7493ca165d9fa3e8f503d~mv2.jpg/v1/fill/w_390,h_844,al_c/8e80e7_e9cc2e6993d7493ca165d9fa3e8f503d~mv2.jpg';

describe( 'wixMediaVariant', () => {
	it( 'recognises a runtime-swapped crop and keys it by stable media id', () => {
		expect( wixMediaVariant( variant ) ).toEqual( {
			id: '8e80e7_e9cc2e6993d7493ca165d9fa3e8f503d',
			url: variant,
		} );
	} );

	it( 'keys crops of the same asset identically, so viewports can be paired', () => {
		const desktop = variant.replace( 'w_390,h_844', 'w_1440,h_940' );
		expect( wixMediaVariant( desktop )?.id ).toBe( wixMediaVariant( variant )?.id );
	} );

	it( 'ignores a Wix URL that is not a fill variant', () => {
		expect(
			wixMediaVariant(
				'https://static.wixstatic.com/media/8e80e7_e9cc2e6993d7493ca165d9fa3e8f503d~mv2.jpg'
			)
		).toBeNull();
	} );

	it( 'ignores images from other hosts', () => {
		expect( wixMediaVariant( 'https://cdn.example.com/v1/fill/w_390,h_844/photo.jpg' ) ).toBeNull();
	} );

	it( 'ignores empty and local URLs', () => {
		expect( wixMediaVariant( '' ) ).toBeNull();
		expect( wixMediaVariant( '/media/local.avif' ) ).toBeNull();
	} );
} );

describe( 'stripShowcaseMarkup', () => {
	it( 'builds an inner CSS slideshow that fills the captured TPA host box', () => {
		expect( wixStaticMediaUrl( '648e62_abc~mv2.jpg' ) ).toBe(
			'https://static.wixstatic.com/media/648e62_abc~mv2.jpg'
		);
		const { html, css } = stripShowcaseMarkup(
			[
				{ uri: '648e62_one.jpg', title: 'One' },
				{ uri: '648e62_two.jpg', alt: 'Two' },
			],
			{ width: 1340, height: 486 }
		);
		expect( html ).toContain(
			'<img src="https://static.wixstatic.com/media/648e62_one.jpg/v1/fill/w_1340,h_486'
		);
		expect( html ).toContain(
			'<img src="https://static.wixstatic.com/media/648e62_two.jpg/v1/fill/w_1340,h_486'
		);
		expect( html ).toContain( 'alt="One"' );
		expect( html ).toContain( 'alt="Two"' );
		expect( html ).toContain( 'class="dla-slideshow"' );
		expect( html ).toMatch( /^<div class="dla-slideshow">/ );
		expect( html ).not.toContain( '<iframe' );
		expect( html ).not.toMatch( /style="[^"]*(?:width|height):\d+px/ );
		expect( css ).toContain(
			'.dla-slideshow{overflow:hidden;width:100%;height:100%;position:relative}'
		);
		expect( css ).toContain(
			'.dla-slideshow-track{display:flex;height:100%;animation:dla-slideshow'
		);
		expect( css ).toContain( '@keyframes dla-slideshow' );
	} );
} );

describe( 'WIX_CAPTURE_CHROME_SELECTOR', () => {
	it( 'removes Wix overflow and accessibility helpers while preserving authored More controls', () => {
		const $ = load( `
			<nav>
				<button id="authored-more">More</button>
				<li id="menu__more__" aria-hidden="true"><p id="menu__more__label">More</p></li>
				<span id="menu-hiddenA11ySubMenuIndication">Use tab to navigate</span>
			</nav>
			<div id="WIX_ADS">Built with Wix</div>
		` );

		$( WIX_CAPTURE_CHROME_SELECTOR ).remove();

		expect( $( '#menu__more__' ) ).toHaveLength( 0 );
		expect( $( '#menu-hiddenA11ySubMenuIndication' ) ).toHaveLength( 0 );
		expect( $( '#WIX_ADS' ) ).toHaveLength( 0 );
		expect( $( '#authored-more' ).text() ).toBe( 'More' );
	} );
} );

describe( 'preserveWixSlideshowSlides', () => {
	it( 'keeps distinct runtime states while preserving their source semantics', () => {
		const dom = new JSDOM( `<!doctype html><html><head></head><body>
			<div class="wixui-slideshow"><div data-testid="slidesWrapper"><article role="region"><h2>First review</h2><p>First complete testimonial.</p><img src="first.jpg" alt="First"></article></div></div>
		</body></html>` );
		const originalDocument = globalThis.document;
		Object.defineProperty( globalThis, 'document', { configurable: true, value: dom.window.document } );
		try {
			preserveWixSlideshowSlides( {
				slideshowIndex: 0,
				slides: [
					'<article role="region"><h2>First review</h2><p>First complete testimonial.</p><img src="first.jpg" alt="First"></article>',
					'<article role="region"><h2>Second review</h2><p>Second complete testimonial.</p><img src="second.jpg" alt="Second"></article>',
				],
			} );

			const slides = dom.window.document.querySelectorAll( '[data-dla-captured-slide]' );
			expect( slides ).toHaveLength( 2 );
			expect( slides[ 0 ]?.textContent ).toContain( 'First complete testimonial.' );
			expect( slides[ 1 ]?.textContent ).toContain( 'Second complete testimonial.' );
			expect( slides[ 1 ]?.querySelector( 'img' )?.getAttribute( 'src' ) ).toBe( 'second.jpg' );
			expect( slides[ 0 ]?.getAttribute( 'role' ) ).toBe( 'region' );
			expect( dom.window.document.querySelector( '.wixui-slideshow' )?.getAttribute( 'data-dla-captured-slideshow' ) ).toBe( 'true' );
			expect( dom.window.document.querySelector( '#dla-wix-captured-slideshow-css' )?.textContent ).toContain( 'display:none!important' );
		} finally {
			Object.defineProperty( globalThis, 'document', { configurable: true, value: originalDocument } );
		}
	} );
} );

describe( 'collectWixSlideshowSlides', () => {
	it( 'uses distinct authored dot destinations as the complete state count', async () => {
		const dom = new JSDOM( `<!doctype html><html><head></head><body>
			<div class="wixui-slideshow"><div data-testid="slidesWrapper"><article id="first">First review</article></div><nav aria-label="Reviews"><a href="#first"></a><a href="#second"></a></nav></div>
		</body></html>` );
		const originalDocument = globalThis.document;
		Object.defineProperty( globalThis, 'document', { configurable: true, value: dom.window.document } );
		try {
			const next = {
				count: async () => 1,
				click: async () => {
					dom.window.document.querySelector( '[data-testid="slidesWrapper"]' )!.innerHTML =
						'<article id="second">Second review</article>';
				},
			};
			const absent = { count: async () => 0, nth: () => absent };
			const dots = { count: async () => 2, nth: () => absent };
			const root = {
				count: async () => 1,
				nth: () => ( {
					locator: ( selector: string ) =>
						selector.includes( 'nextButton' ) ? next : selector.includes( 'nav[' ) ? dots : absent,
				} ),
			};
			const page = {
				locator: () => root,
				evaluate: async ( fn: ( arg: never ) => unknown, arg: never ) => fn( arg ),
				waitForTimeout: async () => undefined,
			};

			await collectWixSlideshowSlides( page as never );

			const slideshow = dom.window.document.querySelector( '.wixui-slideshow' )!;
			expect( slideshow.getAttribute( 'data-dla-captured-slideshow' ) ).toBe( 'true' );
			expect( slideshow.querySelectorAll( '[data-dla-captured-slide]' ) ).toHaveLength( 2 );
		} finally {
			Object.defineProperty( globalThis, 'document', { configurable: true, value: originalDocument } );
		}
	} );

	it( 'keeps distinct authored states when navigation declares extra destinations', async () => {
		const states = [ '<article id="shared">First review</article>', '<article id="shared">Second review</article>' ];
		let index = 0;
		const dom = new JSDOM( `<!doctype html><html><head></head><body>
			<div class="wixui-slideshow"><div data-testid="slidesWrapper">${ states[ 0 ] }</div><nav aria-label="Reviews"><a href="#one"></a><a href="#two"></a><a href="#three"></a></nav></div>
		</body></html>` );
		const originalDocument = globalThis.document;
		Object.defineProperty( globalThis, 'document', { configurable: true, value: dom.window.document } );
		try {
			const next = {
				count: async () => 1,
				click: async () => {
					index = ( index + 1 ) % states.length;
					dom.window.document.querySelector( '[data-testid="slidesWrapper"]' )!.innerHTML = states[ index ]!;
				},
			};
			const absent = { count: async () => 0, nth: () => absent };
			const dots = { count: async () => 3, nth: () => absent };
			const root = {
				count: async () => 1,
				nth: () => ( {
					locator: ( selector: string ) =>
						selector.includes( 'nextButton' ) ? next : selector.includes( 'nav[' ) ? dots : absent,
				} ),
			};
			const page = {
				locator: () => root,
				evaluate: async ( fn: ( arg: never ) => unknown, arg: never ) => fn( arg ),
				waitForTimeout: async () => undefined,
			};

			await collectWixSlideshowSlides( page as never );

			const slideshow = dom.window.document.querySelector( '.wixui-slideshow' )!;
			expect( slideshow.getAttribute( 'data-dla-captured-slideshow' ) ).toBe( 'true' );
			expect( slideshow.querySelectorAll( '[data-dla-captured-slide]' ) ).toHaveLength( 2 );
			expect( slideshow.textContent ).toContain( 'First review' );
			expect( slideshow.textContent ).toContain( 'Second review' );
		} finally {
			Object.defineProperty( globalThis, 'document', { configurable: true, value: originalDocument } );
		}
	} );

	it( 'stops at a repeated runtime state and installs the distinct snapshots', async () => {
		let clicks = 0;
		const next = { count: async () => 1, click: async () => void ( clicks++ ) };
		const absent = { count: async () => 0, nth: () => absent };
		const root = {
			count: async () => 1,
			nth: () => ( {
				locator: ( selector: string ) =>
					selector.includes( 'nextButton' ) ? next : absent,
			} ),
		};
		const evaluations = [
			{ html: '<article>First</article>', key: 'First' },
			null,
			{ html: '<article>Second</article>', key: 'Second' },
			undefined,
		];
		const calls: unknown[][] = [];
		const page = {
			locator: () => root,
			evaluate: async ( fn: unknown, arg: unknown ) => {
				calls.push( [ fn, arg ] );
				return evaluations[ calls.length - 1 ];
			},
			waitForTimeout: async () => undefined,
		};

		await collectWixSlideshowSlides( page as never );

		expect( calls ).toHaveLength( 4 );
		expect( calls[ 3 ]?.[ 1 ] ).toEqual( {
			slideshowIndex: 0,
			slides: [ '<article>First</article>', '<article>Second</article>' ],
		} );
		expect( clicks ).toBe( 1 );
	} );
} );

describe( 'wix capture', () => {
	it( 'declares platform chrome removal selectors', () => {
		expect( capture.removeSelectors ).toEqual( [
			'[id="WIX_ADS"]',
			'[id$="-hiddenA11ySubMenuIndication"]',
		] );
	} );

	it( 'settles generated desktop overflow into reachable navigation links', async () => {
		const dom = new JSDOM( `
			<header><ul>
				<li><a href="/">Home</a></li>
				<li id="menu__more__"><div data-testid="linkElement">More</div></li>
				<li aria-hidden="true" style="height:0;overflow:hidden;position:absolute"><a href="/contact/"><span tabindex="-1">Contact</span></a></li>
			</ul></header>
		` );
		vi.stubGlobal( 'document', dom.window.document );
		vi.stubGlobal( 'getComputedStyle', dom.window.getComputedStyle.bind( dom.window ) );
		vi.stubGlobal( 'requestAnimationFrame', ( callback: FrameRequestCallback ) => setTimeout( callback, 0 ) as unknown as number );
		vi.spyOn( dom.window.HTMLElement.prototype, 'getBoundingClientRect' ).mockReturnValue(
			{ width: 10, height: 10 } as DOMRect
		);
		await settleWixNavigation( 'desktop' );

		const contact = dom.window.document.querySelector( 'a[href="/contact/"]' )!;
		expect( dom.window.document.querySelector( '#menu__more__' ) ).toBeNull();
		expect( contact.closest( 'li' )?.getAttribute( 'aria-hidden' ) ).toBeNull();
		expect( contact.closest( 'li' )?.getAttribute( 'style' ) ).toBe( '' );
		expect( contact.querySelector( '[tabindex]' ) ).toBeNull();
	} );

	it( 'settles the mobile drawer into reachable navigation links', async () => {
		const dom = new JSDOM( `
			<header>
				<button id="MENU_AS_CONTAINER_TOGGLE">Menu</button>
				<ul><li aria-hidden="true" style="display:none"><a href="/contact/"><span tabindex="-1">Contact</span></a></li></ul>
			</header>
		` );
		const toggle = dom.window.document.querySelector< HTMLButtonElement >( '#MENU_AS_CONTAINER_TOGGLE' )!;
		const click = vi.spyOn( toggle, 'click' );
		vi.stubGlobal( 'document', dom.window.document );
		vi.stubGlobal( 'getComputedStyle', dom.window.getComputedStyle.bind( dom.window ) );
		vi.stubGlobal( 'requestAnimationFrame', ( callback: FrameRequestCallback ) => setTimeout( callback, 0 ) as unknown as number );
		vi.spyOn( dom.window.HTMLElement.prototype, 'getBoundingClientRect' ).mockReturnValue(
			{ width: 10, height: 10 } as DOMRect
		);
		await settleWixNavigation( 'mobile' );

		const contact = dom.window.document.querySelector( 'a[href="/contact/"]' )!;
		expect( click ).toHaveBeenCalledOnce();
		expect( dom.window.document.querySelector( '#MENU_AS_CONTAINER_TOGGLE' ) ).toBe( toggle );
		expect( contact.closest( 'li' )?.getAttribute( 'aria-hidden' ) ).toBeNull();
		expect( contact.closest( 'li' )?.getAttribute( 'style' ) ).toBe( '' );
		expect( contact.querySelector( '[tabindex]' ) ).toBeNull();
	} );

	it( 'is attached to the adapter', () => {
		expect( wixAdapter.liberation ).toBe( capture );
	} );
} );

describe( 'settleScrollReactiveChrome', () => {
	it( 'returns to the top and tells the scroll handler before the freeze', async () => {
		const calls: string[] = [];
		const dom = new JSDOM( '<header id="SITE_HEADER"></header>' );
		dom.window.scrollTo = ( () => calls.push( 'scrollTo' ) ) as unknown as typeof window.scrollTo;
		dom.window.dispatchEvent = ( ( event: Event ) => {
			calls.push( `dispatch:${ event.type }` );
			return true;
		} ) as unknown as typeof window.dispatchEvent;
		dom.window.document.getAnimations = () => [];
		const page = {
			evaluate: async ( fn: () => unknown ) => {
				vi.stubGlobal( 'window', dom.window );
				vi.stubGlobal( 'document', dom.window.document );
				return fn();
			},
			waitForTimeout: async ( ms: number ) => {
				calls.push( `wait:${ ms }` );
			},
		};

		await settleScrollReactiveChrome( page as never );

		// The order is the contract: a handler that only recomputes on an event
		// needs the event, and its transition needs time before serialization.
		expect( calls ).toEqual( [ 'scrollTo', 'dispatch:scroll', 'wait:400' ] );
	} );
} );

afterEach( () => vi.unstubAllGlobals() );
