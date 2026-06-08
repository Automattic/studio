import { describe, expect, it } from 'vitest';
import {
	findAiImages,
	getAttr,
	parseAiImageAlt,
	resolveAiImagesInHtml,
	stripAiImagePlaceholders,
} from 'cli/ai/tools/site-generator/images';
import {
	extractJson,
	isTransientError,
	runPooled,
	stripCodeFences,
} from 'cli/ai/tools/site-generator/llm';
import { parseManifest } from 'cli/ai/tools/site-generator/manifest';
import { assertInside, deriveSlug, isValidSlug } from 'cli/ai/tools/site-generator/paths';
import { aspectFromHint } from 'cli/ai/tools/site-generator/wpcom-image';

describe( 'stripCodeFences', () => {
	it( 'removes a single wrapping fence', () => {
		expect( stripCodeFences( '```json\n{"a":1}\n```' ) ).toBe( '{"a":1}' );
		expect( stripCodeFences( '```\nhello\n```' ) ).toBe( 'hello' );
	} );

	it( 'strips a fence with no newline before the closing backticks', () => {
		expect( stripCodeFences( '```json\n{"a":1}```' ) ).toBe( '{"a":1}' );
	} );

	it( 'recovers content from an unclosed (truncated) opening fence', () => {
		expect( stripCodeFences( '```json\n{"a":1}' ) ).toBe( '{"a":1}' );
	} );

	it( 'leaves unfenced content untouched', () => {
		expect( stripCodeFences( '  <div>x</div>  ' ) ).toBe( '<div>x</div>' );
	} );
} );

describe( 'extractJson', () => {
	it( 'extracts an object from a fenced + prose-wrapped response', () => {
		const raw = 'Here is the manifest:\n```json\n{ "themeSlug": "acme", "n": 1 }\n```\nDone.';
		expect( JSON.parse( extractJson( raw ) ) ).toEqual( { themeSlug: 'acme', n: 1 } );
	} );

	it( 'extracts an object from an unclosed fence (truncated wrapper)', () => {
		expect( JSON.parse( extractJson( '```json\n{ "a": [1,2], "b": "x" }' ) ) ).toEqual( {
			a: [ 1, 2 ],
			b: 'x',
		} );
	} );

	it( 'extracts a JSON array', () => {
		expect(
			JSON.parse( extractJson( '```json\n[ { "name": "A" }, { "name": "B" } ]\n```' ) )
		).toEqual( [ { name: 'A' }, { name: 'B' } ] );
	} );
} );

describe( 'isTransientError', () => {
	it( 'flags retryable statuses and messages', () => {
		expect( isTransientError( { status: 503 } ) ).toBe( true );
		expect( isTransientError( { status: 429 } ) ).toBe( true );
		expect( isTransientError( { status: 529 } ) ).toBe( true );
		expect( isTransientError( new Error( 'WordPress.com — 503 Error' ) ) ).toBe( true );
		expect( isTransientError( new Error( 'Overloaded' ) ) ).toBe( true );
		expect( isTransientError( new Error( 'ECONNRESET' ) ) ).toBe( true );
	} );

	it( 'does not flag client errors', () => {
		expect( isTransientError( { status: 400 } ) ).toBe( false );
		expect( isTransientError( { status: 401 } ) ).toBe( false );
		expect( isTransientError( new Error( 'invalid request: missing field' ) ) ).toBe( false );
	} );
} );

describe( 'runPooled', () => {
	it( 'runs every task and preserves order regardless of completion timing', async () => {
		const tasks = [ 30, 5, 20, 1, 10 ].map(
			( delay, index ) => () =>
				new Promise< number >( ( resolve ) => setTimeout( () => resolve( index ), delay ) )
		);
		const results = await runPooled( tasks, 2 );
		expect( results ).toEqual( [ 0, 1, 2, 3, 4 ] );
	} );

	it( 'handles an empty task list', async () => {
		expect( await runPooled( [], 4 ) ).toEqual( [] );
	} );
} );

describe( 'paths', () => {
	it( 'derives and validates slugs', () => {
		expect( deriveSlug( 'Ember & Oak!' ) ).toBe( 'ember-oak' );
		expect( isValidSlug( 'ember-oak' ) ).toBe( true );
		expect( isValidSlug( '-bad' ) ).toBe( false );
		expect( isValidSlug( 'Bad Slug' ) ).toBe( false );
	} );

	it( 'allows writes inside the package and rejects escapes', () => {
		const base = '/tmp/site/wp-content/themes/acme';
		expect( assertInside( base, 'parts/header.html' ) ).toBe(
			'/tmp/site/wp-content/themes/acme/parts/header.html'
		);
		expect( () => assertInside( base, '../../../../etc/passwd' ) ).toThrow();
		expect( () => assertInside( base, '/etc/passwd' ) ).toThrow();
	} );
} );

describe( 'aspectFromHint', () => {
	it( 'maps tokens, keywords, and dimensions to Imagen aspect ratios', () => {
		expect( aspectFromHint( '16:9' ) ).toBe( '16:9' );
		expect( aspectFromHint( 'hero' ) ).toBe( '16:9' );
		expect( aspectFromHint( 'portrait' ) ).toBe( '3:4' );
		expect( aspectFromHint( 'square' ) ).toBe( '1:1' );
		expect( aspectFromHint( '1792x1024' ) ).toBe( '16:9' );
		expect( aspectFromHint( '1080x1920' ) ).toBe( '9:16' );
		expect( aspectFromHint( undefined ) ).toBe( '16:9' );
	} );
} );

describe( 'AI_IMAGE parsing', () => {
	it( 'parses the alt convention', () => {
		expect( parseAiImageAlt( 'AI_IMAGE: a wood-fired oven | photographic | 16:9' ) ).toEqual( {
			description: 'a wood-fired oven',
			style: 'photographic',
			aspect: '16:9',
		} );
		expect( parseAiImageAlt( 'just an alt' ) ).toBeNull();
	} );

	it( 'reads attributes from a tag', () => {
		const tag = '<img src="x.png" alt="AI_IMAGE: hero | photo | 16:9" />';
		expect( getAttr( tag, 'src' ) ).toBe( 'x.png' );
		expect( getAttr( tag, 'alt' ) ).toBe( 'AI_IMAGE: hero | photo | 16:9' );
	} );

	it( 'finds only AI_IMAGE placeholders among images', () => {
		const html =
			'<img src="real.jpg" alt="A real photo">' +
			'<img src="ph.png" alt="AI_IMAGE: a cafe interior | photographic | 16:9">';
		const found = findAiImages( html );
		expect( found ).toHaveLength( 1 );
		expect( found[ 0 ].description ).toBe( 'a cafe interior' );
	} );

	it( 'strips AI_IMAGE placeholders but keeps real images', () => {
		const html =
			'<p>x</p><img src="real.jpg" alt="A real photo" />' +
			'<img class="bg" src="ph.png" alt="AI_IMAGE: hero | photo | 16:9" /><p>y</p>';
		const stripped = stripAiImagePlaceholders( html );
		expect( stripped ).toContain( 'real.jpg' );
		expect( stripped ).not.toContain( 'AI_IMAGE' );
		expect( stripped ).toBe( '<p>x</p><img src="real.jpg" alt="A real photo" /><p>y</p>' );
	} );
} );

describe( 'resolveAiImagesInHtml', () => {
	const html =
		'<p>a</p><img src="ph.png" alt="AI_IMAGE: a hero | photo | 16:9" />' +
		'<img src="ph2.png" alt="AI_IMAGE: a chef | photo | 4:3" />';

	it( 'fills every placeholder via the injected generator, preserving order and index', async () => {
		let generateCalls = 0;
		const persistedIndexes: number[] = [];
		const result = await resolveAiImagesInHtml(
			html,
			async ( _bytes, ctx ) => {
				persistedIndexes.push( ctx.index );
				return `https://cdn/img-${ ctx.index }.png`;
			},
			{
				concurrency: 4,
				generate: async () => {
					generateCalls++;
					return Buffer.from( 'img' );
				},
			}
		);
		expect( generateCalls ).toBe( 2 );
		expect( result.generated ).toBe( 2 );
		expect( result.failed ).toBe( 0 );
		expect( result.total ).toBe( 2 );
		expect( result.html ).toContain( 'src="https://cdn/img-1.png"' );
		expect( result.html ).toContain( 'src="https://cdn/img-2.png"' );
		expect( result.html ).toContain( 'alt="a hero"' );
		expect( result.html ).toContain( 'alt="a chef"' );
		expect( result.html ).not.toContain( 'AI_IMAGE' );
		expect( persistedIndexes.slice().sort() ).toEqual( [ 1, 2 ] );
	} );

	it( 'counts a persist failure without aborting the others', async () => {
		const result = await resolveAiImagesInHtml(
			html,
			async ( _bytes, ctx ) => ( ctx.index === 1 ? null : `https://cdn/img-${ ctx.index }.png` ),
			{ generate: async () => Buffer.from( 'img' ) }
		);
		expect( result.generated ).toBe( 1 );
		expect( result.failed ).toBe( 1 );
		expect( result.html ).toContain( 'https://cdn/img-2.png' );
	} );

	it( 'counts a generation error without aborting the others', async () => {
		let calls = 0;
		const result = await resolveAiImagesInHtml(
			html,
			async ( _bytes, ctx ) => `https://cdn/img-${ ctx.index }.png`,
			{
				generate: async () => {
					calls++;
					if ( calls === 1 ) {
						throw new Error( 'boom' );
					}
					return Buffer.from( 'img' );
				},
			}
		);
		expect( result.generated ).toBe( 1 );
		expect( result.failed ).toBe( 1 );
	} );
} );

describe( 'parseManifest', () => {
	it( 'parses a full manifest', () => {
		const manifest = parseManifest(
			JSON.stringify( {
				themeSlug: 'Ember Oak',
				themeName: 'Ember & Oak',
				layoutMode: 'landing-page',
				contentMode: 'homepage-and-pages',
				parts: [ 'header', 'footer' ],
				templates: [ 'index', 'page' ],
				pages: [ { slug: 'Home', title: 'Home', brief: 'hero + menu teaser' } ],
				companionPlugin: {
					needed: true,
					slug: 'ember-oak-functionality',
					name: 'Ember & Oak Functionality',
					postTypes: [
						{ slug: 'dish', name: 'Dish', fields: [ { key: 'price', type: 'number' } ] },
					],
					restRoutes: [ { path: '/ember/v1/reserve', purpose: 'reservations' } ],
					blocks: [ { slug: 'reservation-form', title: 'Reservation Form', purpose: 'booking' } ],
				},
				seed: [ { type: 'page', slug: 'home', title: 'Home' } ],
			} )
		);

		expect( manifest.themeSlug ).toBe( 'ember-oak' );
		expect( manifest.layoutMode ).toBe( 'landing-page' );
		expect( manifest.pages[ 0 ].slug ).toBe( 'home' );
		expect( manifest.companionPlugin.needed ).toBe( true );
		expect( manifest.companionPlugin.postTypes[ 0 ].fields[ 0 ].type ).toBe( 'number' );
	} );

	it( 'applies safe defaults for a sparse manifest', () => {
		const manifest = parseManifest( JSON.stringify( { themeName: 'Tiny' } ) );
		expect( manifest.themeSlug ).toBe( 'tiny' );
		expect( manifest.layoutMode ).toBe( 'vertical-stack' );
		expect( manifest.contentMode ).toBe( 'homepage-and-pages' );
		expect( manifest.parts ).toEqual( [ 'header', 'footer' ] );
		expect( manifest.templates ).toEqual( [ 'index', 'page' ] );
		expect( manifest.companionPlugin.needed ).toBe( false );
	} );

	it( 'normalizes an unknown layout mode and bad field types', () => {
		const manifest = parseManifest(
			JSON.stringify( {
				themeName: 'X',
				layoutMode: 'spaceship',
				companionPlugin: {
					needed: true,
					postTypes: [ { slug: 'thing', name: 'Thing', fields: [ { key: 'k', type: 'weird' } ] } ],
				},
			} )
		);
		expect( manifest.layoutMode ).toBe( 'vertical-stack' );
		expect( manifest.companionPlugin.slug ).toBe( 'x-functionality' );
		expect( manifest.companionPlugin.postTypes[ 0 ].fields[ 0 ].type ).toBe( 'string' );
	} );

	it( 'throws on invalid JSON', () => {
		expect( () => parseManifest( 'not json' ) ).toThrow();
	} );

	it( 'canonicalizes identifiers under a single themePrefix', () => {
		const manifest = parseManifest(
			JSON.stringify( {
				themeName: 'Ember & Oak',
				themeSlug: 'ember-oak',
				templates: [ 'index', 'page', 'archive-eo_menu_item', 'single-eo_menu_item' ],
				companionPlugin: {
					needed: true,
					postTypes: [
						{
							slug: 'eo-menu-item',
							name: 'Menu Item',
							fields: [ { key: 'price', type: 'number' } ],
						},
						{ slug: 'eo-reservation', name: 'Reservation', fields: [] },
					],
					blocks: [
						{ slug: 'ember-oak-reservation-form', title: 'Reservation Form', purpose: 'booking' },
					],
					restRoutes: [ { path: '/ember-oak/v1/reservations', purpose: 'reservations' } ],
				},
			} )
		);

		expect( manifest.themePrefix ).toBe( 'ember' );
		expect( manifest.companionPlugin.postTypes.map( ( p ) => p.slug ) ).toEqual( [
			'ember_menu_item',
			'ember_reservation',
		] );
		expect( manifest.companionPlugin.blocks[ 0 ].slug ).toBe( 'reservation-form' );
		expect( manifest.companionPlugin.restRoutes[ 0 ].path ).toBe( '/ember/v1/reservations' );
		// CPT archive/single templates are re-keyed to the canonical post_type key.
		expect( manifest.templates ).toContain( 'archive-ember_menu_item' );
		expect( manifest.templates ).toContain( 'single-ember_menu_item' );
	} );

	it( 'always derives a valid themePrefix even with no companion plugin', () => {
		const manifest = parseManifest( JSON.stringify( { themeName: 'Tiny' } ) );
		expect( manifest.themePrefix ).toMatch( /^[a-z][a-z0-9_]{2,11}$/ );
	} );
} );
