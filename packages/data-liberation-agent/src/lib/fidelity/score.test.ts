import { describe, expect, it } from 'vitest';
import {
	normalizeImageKey,
	scoreReport,
	scoreViewport,
	type LayoutObservation,
	type RenderedImage,
} from './score.js';

const at = ( viewport: number, extra: Partial< LayoutObservation > = {} ): LayoutObservation => ( {
	viewport,
	title: 'Home',
	textChars: 336,
	widestImage: viewport,
	images: [],
	docWidth: viewport,
	overflow: false,
	externalHosts: [],
	hashTargets: [],
	internalMissing: [],
	dialogs: [],
	...extra,
} );

const img = ( key: string, x: number, y: number, width: number, height: number ): RenderedImage => ( {
	key,
	x,
	y,
	width,
	height,
} );

describe( 'scoreViewport', () => {
	it( 'passes when the copy matches the source at an unsampled width', () => {
		const score = scoreViewport( at( 1600 ), at( 1600 ) );
		expect( score.pass ).toBe( true );
		expect( score.failures ).toEqual( [] );
	} );

	it( 'fails when the copy is frozen at the capture width', () => {
		// The Roeeby freeze: source is 1600, copy stuck at 1440.
		const score = scoreViewport( at( 1600 ), at( 1600, { widestImage: 1440 } ) );
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /widest image 1440px !== source 1600px/ );
	} );

	it( 'fails when the copy overflows and the source does not', () => {
		const score = scoreViewport(
			at( 900, { docWidth: 900 } ),
			at( 900, { docWidth: 980, overflow: true } )
		);
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /horizontal overflow/ );
	} );

	it( 'allows overflow only when the source also overflows', () => {
		const score = scoreViewport(
			at( 390, { docWidth: 980, overflow: true, widestImage: 980 } ),
			at( 390, { docWidth: 980, overflow: true, widestImage: 980 } )
		);
		expect( score.pass ).toBe( true );
	} );

	it( 'fails when a same-page hash has no target in the copy', () => {
		const score = scoreViewport(
			at( 1440, { hashTargets: [ { fragment: 'team', resolved: true, targets: 1 } ] } ),
			at( 1440, { hashTargets: [ { fragment: 'team', resolved: false, targets: 0 } ] } )
		);
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /#team/ );
	} );

	it( 'fails when a hash resolves in the copy but to more places than the source', () => {
		const score = scoreViewport(
			at( 1440, { hashTargets: [ { fragment: 'about', resolved: true, targets: 1 } ] } ),
			at( 1440, { hashTargets: [ { fragment: 'about', resolved: true, targets: 2 } ] } )
		);
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /more than one target: #about/ );
	} );

	it( 'accepts a duplicate the source ships too', () => {
		const score = scoreViewport(
			at( 1440, { hashTargets: [ { fragment: 'about', resolved: true, targets: 2 } ] } ),
			at( 1440, { hashTargets: [ { fragment: 'about', resolved: true, targets: 2 } ] } )
		);
		expect( score.pass ).toBe( true );
	} );

	it( 'fails when the source hash worked and the copy dropped it', () => {
		const score = scoreViewport(
			at( 1440, { hashTargets: [ { fragment: 'features', resolved: true, targets: 1 } ] } ),
			at( 1440 )
		);
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /#features/ );
	} );

	it( 'fails when an internal path 404s in the copy', () => {
		const score = scoreViewport( at( 1440 ), at( 1440, { internalMissing: [ '/about/' ] } ) );
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /\/about\// );
	} );

	it( 'treats overlapping dialog labels as the same trigger', () => {
		const score = scoreViewport(
			at( 390, { dialogs: [ { label: 'Open Menu', opened: true } ] } ),
			at( 390, { dialogs: [ { label: 'Open Menu Close Menu', opened: true } ] } )
		);
		expect( score.pass ).toBe( true );
	} );

	it( 'fails when a source dialog does not open in the copy', () => {
		const score = scoreViewport(
			at( 1440, { dialogs: [ { label: 'Menu', opened: true } ] } ),
			at( 1440, { dialogs: [ { label: 'Menu', opened: false } ] } )
		);
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /Menu/ );
	} );

	it( 'fails when the copy still talks to the source CDN', () => {
		const score = scoreViewport(
			at( 1440 ),
			at( 1440, { externalHosts: [ 'siteassets.parastorage.com' ] } )
		);
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /parastorage/ );
	} );

	it( 'fails on text or title drift', () => {
		expect( scoreViewport( at( 1440 ), at( 1440, { textChars: 300 } ) ).pass ).toBe( false );
		expect( scoreViewport( at( 1440 ), at( 1440, { title: 'Other' } ) ).pass ).toBe( false );
	} );

	it( 'tolerates one pixel of image rounding', () => {
		expect( scoreViewport( at( 1440, { widestImage: 1440 } ), at( 1440, { widestImage: 1441 } ) ).pass ).toBe(
			true
		);
	} );

	it( 'passes when the copy renders the same images as the source', () => {
		const images = [ img( 'hero.jpg', 0, 96, 1600, 600 ), img( 'team.jpg', 32, 900, 400, 300 ) ];
		const score = scoreViewport( at( 1600, { images } ), at( 1600, { images } ) );
		expect( score.pass ).toBe( true );
		expect( score.failures ).toEqual( [] );
	} );

	it( 'fails when the copy ships an empty slideshow, naming how many slides and where they sit', () => {
		// The Ummels regression: the copy kept the header banner (so the
		// widest-image check passed) but rendered the homepage slideshow with
		// zero slides, and compare passed at 1600/1728/390 because nothing
		// counted rendered images.
		const header = img( 'header.jpg', 0, 0, 1600, 96 );
		const slides = [
			img( 'dakkapel-slide.jpg', 0, 96, 1600, 600 ),
			img( 'goot-slide.jpg', 0, 96, 1600, 600 ),
			img( 'bedrijfsbus-slide.jpg', 0, 96, 1600, 600 ),
		];
		const score = scoreViewport(
			at( 1600, { images: [ header, ...slides ] } ),
			at( 1600, { images: [ header ] } )
		);
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /^images 3 of 4 missing/ );
		expect( score.failures[ 0 ] ).toContain( 'dakkapel-slide.jpg 1600x600 at (0,96)' );
	} );

	it( 'does not fail when the copy renders extra images', () => {
		const source = [ img( 'hero.jpg', 0, 0, 1600, 600 ) ];
		const copy = [
			img( 'hero.jpg', 0, 0, 1600, 600 ),
			img( 'wordpress-badge.png', 700, 2400, 200, 80 ),
		];
		const score = scoreViewport( at( 1600, { images: source } ), at( 1600, { images: copy } ) );
		expect( score.pass ).toBe( true );
		expect( score.notes ).toContain( 'images 1 extra in copy (not a failure)' );
	} );

	it( 'tolerates one missing image for lazy-load or carousel drift', () => {
		const source = [ img( 'hero.jpg', 0, 0, 1600, 600 ), img( 'footer-badge.png', 640, 2400, 320, 120 ) ];
		const score = scoreViewport(
			at( 1600, { images: source } ),
			at( 1600, { images: source.slice( 0, 1 ) } )
		);
		expect( score.pass ).toBe( true );
		expect( score.notes ).toContain( 'images 1 missing within tolerance' );
	} );

	it( 'matches same-named images by count, not presence', () => {
		const gallery = [ img( 'divider.jpg', 0, 800, 1600, 60 ), img( 'divider.jpg', 0, 1600, 1600, 60 ), img( 'divider.jpg', 0, 2400, 1600, 60 ) ];
		const score = scoreViewport( at( 1600, { images: gallery } ), at( 1600, { images: gallery.slice( 0, 1 ) } ) );
		expect( score.pass ).toBe( false );
		expect( score.failures[ 0 ] ).toMatch( /^images 2 of 3 missing/ );
	} );

	it( 'refuses to score mismatched viewports', () => {
		expect( () => scoreViewport( at( 1440 ), at( 1600 ) ) ).toThrow( /mismatched viewports/ );
	} );
} );

describe( 'normalizeImageKey', () => {
	it( 'keeps identity across re-localized URLs', () => {
		expect( normalizeImageKey( 'https://cdn.example.com/img/hero.jpg?v=3' ) ).toBe(
			normalizeImageKey( 'http://localhost:8871/wp-content/uploads/2026/08/hero.jpg' )
		);
	} );

	it( 'strips WordPress collision and generated-size suffixes', () => {
		expect( normalizeImageKey( '/wp-content/uploads/2026/08/hero-2.jpg' ) ).toBe( 'hero' );
		expect( normalizeImageKey( 'https://a.example.com/img/hero-1024x576.jpg' ) ).toBe( 'hero' );
		expect( normalizeImageKey( 'https://a.example.com/img/HERO-scaled.jpg' ) ).toBe( 'hero' );
	} );

	it( 'survives a re-encoded, tilde-folded Wix media id', () => {
		// Measured on a live liberation: the source serves `~mv2.png` from
		// wixstatic and the copy serves `-mv2-2.avif` from its own media
		// directory. Matching on the filename reported every image both
		// missing and extra at once.
		const source =
			'https://static.wixstatic.com/media/84770f_036df751d6ad458abdb34ad1da5a52fb~mv2.png/v1/fill/w_919,h_131/84770f_036df751d6ad458abdb34ad1da5a52fb~mv2.png';
		const copy = 'http://127.0.0.1:53001/media/84770f_036df751d6ad458abdb34ad1da5a52fb-mv2-2.avif';
		expect( normalizeImageKey( copy ) ).toBe( normalizeImageKey( source ) );
	} );

	it( 'treats a re-encoded image as the same image', () => {
		expect( normalizeImageKey( 'https://a.example.com/img/hero.png' ) ).toBe(
			normalizeImageKey( 'http://127.0.0.1:53001/media/hero.avif' )
		);
	} );

	it( 'leaves meaningful name parts alone', () => {
		expect( normalizeImageKey( 'https://a.example.com/img/hero-card.jpg' ) ).toBe( 'hero-card' );
	} );

	it( 'collapses inline payloads to a stable token', () => {
		expect( normalizeImageKey( 'data:image/png;base64,AAAA' ) ).toBe( 'data:image/png' );
		expect( normalizeImageKey( 'data:image/png;base64,BBBB' ) ).toBe( 'data:image/png' );
	} );

	it( 'collapses runtime-minted blob URLs to a stable token', () => {
		expect( normalizeImageKey( 'blob:https://example.com/8b1a-uuid' ) ).toBe(
			normalizeImageKey( 'blob:http://localhost:8871/different-uuid' )
		);
	} );
} );

describe( 'scoreReport', () => {
	it( 'passes only when every viewport passes', () => {
		const ok = scoreViewport( at( 1600 ), at( 1600 ) );
		const bad = scoreViewport( at( 1728 ), at( 1728, { widestImage: 1440 } ) );
		expect( scoreReport( [ ok ] ) ).toEqual( { pass: true, failed: 0, passed: 1 } );
		expect( scoreReport( [ ok, bad ] ) ).toEqual( { pass: false, failed: 1, passed: 1 } );
	} );
} );
