import { describe, expect, it } from 'vitest';
import { contractFromManifest } from 'cli/ai/generation/identifier-contract';
import { parseManifest, type SiteManifest } from 'cli/ai/generation/manifest';
import { buildSiteTasks, routeResults } from 'cli/ai/generation/orchestrate';

function manifest(): SiteManifest {
	return parseManifest(
		JSON.stringify( {
			themeName: 'Ember & Oak',
			themeSlug: 'ember-oak',
			layoutMode: 'landing-page',
			contentMode: 'homepage-and-pages',
			parts: [ 'header', 'footer' ],
			templates: [ 'index', 'page' ],
			pages: [
				{ slug: 'home', title: 'Home', brief: 'hero' },
				{ slug: 'menu', title: 'Menu', brief: 'dishes' },
			],
			companionPlugin: {
				needed: true,
				postTypes: [ { slug: 'menu_item', name: 'Menu Item', fields: [] } ],
				blocks: [ { slug: 'reservation-form', title: 'Reservation Form', purpose: 'booking' } ],
				restRoutes: [],
			},
			seed: [],
		} )
	);
}

describe( 'buildSiteTasks', () => {
	it( 'assembles one flat task list across theme + plugin + content', () => {
		const m = manifest();
		const tasks = buildSiteTasks( m, {
			specJson: '{}',
			design: '',
			vocabulary: '',
			contract: contractFromManifest( m ),
			finalizeImages: async ( content ) => ( { content, generated: 0, failed: 0 } ),
		} );
		// theme.json + style.css + 2 parts + 2 templates = 6 theme
		// + 1 plugin-main + 1 block = 2 plugin
		// + 2 pages + 1 cpt = 3 content
		expect( tasks ).toHaveLength( 6 + 2 + 3 );
		expect( typeof tasks[ 0 ] ).toBe( 'function' );
	} );

	it( 'omits plugin + cpt tasks for a brochure manifest', () => {
		const m = parseManifest(
			JSON.stringify( { themeName: 'Brochure', pages: [ { slug: 'home', title: 'Home' } ] } )
		);
		const tasks = buildSiteTasks( m, {
			specJson: '{}',
			design: '',
			vocabulary: '',
			contract: contractFromManifest( m ),
			finalizeImages: async ( content ) => ( { content, generated: 0, failed: 0 } ),
		} );
		// theme.json + style.css + 2 default parts + 2 default templates + 1 page = 7
		expect( tasks ).toHaveLength( 2 + 2 + 2 + 1 );
	} );
} );

describe( 'routeResults', () => {
	it( 'groups results by kind and isolates failures', () => {
		const routed = routeResults( [
			{ kind: 'theme-file', rel: 'style.css', content: 'css' },
			{ kind: 'plugin-main', content: '<?php', error: null },
			{
				kind: 'plugin-block',
				block: { slug: 'a', title: 'A', purpose: '' },
				files: { 'block.json': '{}' },
				error: null,
			},
			{
				kind: 'plugin-block',
				block: { slug: 'b', title: 'B', purpose: '' },
				files: {},
				error: 'boom',
			},
			{
				kind: 'page',
				item: {
					postType: 'page',
					slug: 'home',
					title: 'Home',
					content: '',
					meta: {},
					isHome: true,
				},
				label: 'page:home',
				generated: 2,
				failed: 0,
				error: null,
			},
			{ kind: 'page', item: null, label: 'page:about', generated: 0, failed: 1, error: 'fail' },
			{
				kind: 'cpt',
				items: [
					{
						postType: 'menu_item',
						slug: 'soup',
						title: 'Soup',
						content: '',
						meta: {},
						isHome: false,
					},
				],
				label: 'menu_item',
				generated: 1,
				failed: 0,
				error: null,
			},
		] );

		expect( routed.themeFiles ).toHaveLength( 1 );
		expect( routed.pluginMain ).toBe( '<?php' );
		expect( routed.pluginBlocks ).toHaveLength( 1 );
		expect( routed.pluginBlockGenFailures ).toEqual( [ 'b (boom)' ] );
		expect( routed.prepared.map( ( p ) => p.slug ) ).toEqual( [ 'home', 'soup' ] );
		expect( routed.generationFailed ).toEqual( [ 'page:about' ] );
		expect( routed.cptCounts ).toEqual( [ 'menu_item: 1' ] );
		expect( routed.imagesGenerated ).toBe( 3 );
		expect( routed.imagesFailed ).toBe( 1 );
	} );

	it( 'records a failed plugin-main as a generation failure', () => {
		const routed = routeResults( [ { kind: 'plugin-main', content: '', error: 'overloaded' } ] );
		expect( routed.pluginMain ).toBeNull();
		expect( routed.generationFailed[ 0 ] ).toContain( 'plugin-main' );
	} );
} );
