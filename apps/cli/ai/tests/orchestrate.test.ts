import { describe, expect, it } from 'vitest';
import { contractFromManifest } from 'cli/ai/generation/identifier-contract';
import { parseManifest, type SiteManifest } from 'cli/ai/generation/manifest';
import {
	buildSiteTasks,
	routeResults,
	summarizeSiteGeneration,
	validateSiteArtifacts,
	type GeneratedSiteArtifacts,
	type SiteGenerationPlan,
	type StagedSiteGeneration,
} from 'cli/ai/generation/orchestrate';
import type { SiteData } from 'cli/lib/cli-config/core';

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

function plan( m = manifest() ): SiteGenerationPlan {
	return {
		phase: 'plan',
		mode: 'guided',
		site: { id: 'site-id', name: 'Test Site', path: '/tmp/test-site' } as SiteData,
		specJson: '{}',
		design: '',
		manifest: m,
		contract: contractFromManifest( m ),
		vocabulary: '',
		themeSlug: m.themeSlug,
		themeDirectory: `/tmp/test-site/wp-content/themes/${ m.themeSlug }`,
		pluginDirectory: `/tmp/test-site/wp-content/plugins/${ m.companionPlugin.slug }`,
		siteUrl: 'http://localhost:8881',
		withImages: true,
		imagesOk: true,
	};
}

function artifacts( overrides: Partial< GeneratedSiteArtifacts > = {} ): GeneratedSiteArtifacts {
	const m = manifest();
	return {
		phase: 'generate-artifacts',
		manifest: m,
		taskCount: 1,
		imagesPersisted: false,
		routed: {
			themeFiles: [ { rel: 'theme.json', content: '{}' } ],
			pluginMain: null,
			pluginBlocks: [],
			prepared: [],
			generationFailed: [],
			pluginBlockGenFailures: [],
			cptCounts: [],
			imagesGenerated: 0,
			imagesFailed: 0,
		},
		...overrides,
	};
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

describe( 'site generation engine phases', () => {
	it( 'validates generated artifacts before apply', () => {
		const p = plan();
		const validation = validateSiteArtifacts( p, artifacts() );

		expect( validation.phase ).toBe( 'validate' );
		expect( validation.styleOk ).toBe( false );
		expect( validation.pluginFailed ).toBe( true );
	} );

	it( 'summarizes guided generation as a review payload without writes', () => {
		const p = plan();
		const generated = artifacts( {
			routed: {
				...artifacts().routed,
				themeFiles: [ { rel: 'style.css', content: '/* Theme */' } ],
				pluginMain: '<?php',
				prepared: [
					{
						postType: 'page',
						slug: 'home',
						title: 'Home',
						content: '',
						meta: {},
						isHome: true,
					},
				],
			},
		} );
		const summary = summarizeSiteGeneration(
			p,
			generated,
			validateSiteArtifacts( p, generated ),
			undefined,
			{
				runId: '123e4567-e89b-12d3-a456-426614174000',
				filePath: '/tmp/studio-site-generation/123e4567-e89b-12d3-a456-426614174000.json',
			} satisfies StagedSiteGeneration
		);

		expect( summary ).toContain( 'No files were written' );
		expect( summary ).toContain( 'STAGED_RUN_ID: 123e4567-e89b-12d3-a456-426614174000' );
		expect( summary ).toContain( 'apply these exact artifacts' );
		expect( summary ).toContain( 'Content prepared for review: 1 items' );
		expect( summary ).toContain( 'MANIFEST' );
	} );
} );

describe( 'routeResults', () => {
	it( 'groups results by kind and isolates failures', () => {
		const routed = routeResults( [
			{ kind: 'theme-file', rel: 'style.css', content: 'css', error: null },
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

	it( 'routes a failed theme file to generationFailed, not themeFiles', () => {
		const routed = routeResults( [
			{ kind: 'theme-file', rel: 'style.css', content: '', error: 'overloaded' },
			{ kind: 'theme-file', rel: 'theme.json', content: '{}', error: null },
		] );
		expect( routed.themeFiles.map( ( f ) => f.rel ) ).toEqual( [ 'theme.json' ] );
		expect( routed.generationFailed ).toContain( 'theme:style.css' );
	} );
} );
