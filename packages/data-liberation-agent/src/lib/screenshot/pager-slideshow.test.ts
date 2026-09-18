import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPagerSlideshowStates, collectPagerSlideshowStates } from './pager-slideshow.js';

const picture = ( label: string ) =>
	`data:image/svg+xml;utf8,${ encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><title>${ label }</title></svg>`
	) }`;

const THUMBS = [ picture( 'thumb-0' ), picture( 'thumb-1' ), picture( 'thumb-2' ) ];
const FULL = [ picture( 'full-0' ), picture( 'full-1' ), picture( 'full-2' ) ];

/**
 * A stage that renders one state at a time beside a picker of image-only
 * controls. The first state already carries its full-size media, and every
 * other state only loads that media once its control is activated.
 */
const pagerFixture = ( { brokenLastControl = false } = {} ) => `<!doctype html><html><body>
<div class="showcase">
	<div class="stage">
		<div class="frame"><img src="${ FULL[ 0 ] }"></div>
		<div class="frame" style="display:none"><img src=""></div>
		<div class="frame" style="display:none"><img src=""></div>
	</div>
	<div class="picker" style="width:75px">
		<a data-n="0"><img src="${ THUMBS[ 0 ] }"></a>
		<a data-n="1"><img src="${ THUMBS[ 1 ] }"></a>
		<a data-n="2"><img src="${ THUMBS[ 2 ] }"></a>
	</div>
</div>
<script>
	const full = ${ JSON.stringify( FULL ) };
	const broken = ${ JSON.stringify( brokenLastControl ) };
	for ( const control of document.querySelectorAll( '.picker a' ) ) {
		control.addEventListener( 'click', () => {
			const index = Number( control.dataset.n );
			if ( broken && index === 2 ) return;
			document.querySelectorAll( '.stage > .frame' ).forEach( ( frame, position ) => {
				frame.style.display = position === index ? '' : 'none';
			} );
			document.querySelectorAll( '.stage img' )[ index ].src = full[ index ];
		} );
	}
</script>
</body></html>`;

const LABELLED_CONTROL_FIXTURE = `<!doctype html><html><body>
<div class="showcase">
	<div class="stage">
		<div class="frame"><img src="${ FULL[ 0 ] }"></div>
		<div class="frame" style="display:none"><img src="${ FULL[ 1 ] }"></div>
	</div>
	<div class="picker">
		<a href="/one"><img src="${ THUMBS[ 0 ] }">One</a>
		<a href="/two"><img src="${ THUMBS[ 1 ] }">Two</a>
	</div>
</div>
</body></html>`;

describe( 'pager slideshow capture', () => {
	let browser: Browser;

	beforeAll( async () => {
		browser = await chromium.launch();
	} );

	afterAll( async () => {
		await browser?.close();
	} );

	const openPage = async ( html: string ) => {
		const page = await browser.newPage();
		await page.setContent( html );
		return page;
	};

	it( 'walks every state a thumbnail picker advertises into the frozen document', async () => {
		const page = await openPage( pagerFixture() );
		await applyPagerSlideshowStates( page, await collectPagerSlideshowStates( page ) );

		const slides = await page.$$eval( '[data-dla-pager-stage] > [data-dla-captured-slide]', ( nodes ) =>
			nodes.map( ( node ) => node.querySelector( 'img' )?.getAttribute( 'src' ) ?? '' )
		);
		expect( slides ).toEqual( FULL );
		expect(
			await page.getAttribute( '[data-dla-pager-stage]', 'data-dla-captured-slide-count' )
		).toBe( String( FULL.length ) );
		await page.close();
	} );

	it( 'reads each state only once its own media has loaded', async () => {
		const page = await openPage( pagerFixture() );
		await applyPagerSlideshowStates( page, await collectPagerSlideshowStates( page ) );

		const stage = await page.$eval( '[data-dla-pager-stage]', ( node ) => node.innerHTML );
		for ( const thumbnail of THUMBS.slice( 1 ) ) {
			expect( stage ).not.toContain( thumbnail );
		}
		expect( stage ).not.toContain( 'src=""' );
		await page.close();
	} );

	it( 'leaves one state on stage so the copy opens the way the source did', async () => {
		const page = await openPage( pagerFixture() );
		await applyPagerSlideshowStates( page, await collectPagerSlideshowStates( page ) );

		const shown = await page.$$eval( '[data-dla-pager-stage] > *', ( nodes ) =>
			nodes.filter( ( node ) => getComputedStyle( node ).display !== 'none' ).length
		);
		expect( shown ).toBe( 1 );
		await page.close();
	} );

	it( 'records the advertised count when a control will not advance the stage', async () => {
		const page = await openPage( pagerFixture( { brokenLastControl: true } ) );
		await applyPagerSlideshowStates( page, await collectPagerSlideshowStates( page ) );

		const diagnostics = await page.$eval( '[data-dla-pager-stage]', ( node ) => ( {
			captured: node.getAttribute( 'data-dla-captured-slide-count' ),
			advertised: node.getAttribute( 'data-dla-advertised-slide-count' ),
		} ) );
		expect( diagnostics ).toEqual( { captured: '2', advertised: '3' } );
		await page.close();
	} );

	it( 'leaves a labelled link list alone', async () => {
		const page = await openPage( LABELLED_CONTROL_FIXTURE );
		await applyPagerSlideshowStates( page, await collectPagerSlideshowStates( page ) );

		expect( await page.locator( '[data-dla-captured-slide]' ).count() ).toBe( 0 );
		await page.close();
	} );
} );
