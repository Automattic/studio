import { describe, expect, it } from 'vitest';
import { stripShowcaseMarkup, wixMediaVariant, wixStaticMediaUrl } from './capture.js';

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
