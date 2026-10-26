import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';
import * as checks from './outcome.mjs';

// Each check reads the runner's result file named on stdout, as promptfoo
// hands it over. These results carry only the fields a check reads.
const dir = mkdtempSync( path.join( tmpdir(), 'studio-eval-outcome-test-' ) );
let count = 0;
function run( check, result, vars = {} ) {
	const file = path.join( dir, `result-${ count++ }.json` );
	writeFileSync( file, JSON.stringify( result ) );
	return check( `EVAL_RUNNER_RESULT_FILE=${ file }\n`, { vars } );
}

const outcome = ( site, extra = {} ) => ( {
	outcome: { sites: [ site ], otherSitesChanged: [], otherSitesRemoved: [], ...extra },
} );
const reply = ( ...textSegments ) => ( { textSegments } );

function png( width, height ) {
	const buf = Buffer.alloc( 33 );
	buf.writeUInt32BE( 0x89504e47, 0 );
	buf.writeUInt32BE( width, 16 );
	buf.writeUInt32BE( height, 20 );
	return buf.toString( 'base64' );
}
const screenshots = ( sizes, durationMs ) => ( {
	toolResults: [
		{
			toolName: 'take_screenshot',
			isError: false,
			images: sizes.map( ( [ w, h ] ) => ( { data: png( w, h ) } ) ),
		},
	],
	toolEvents: [ { toolName: 'take_screenshot', durationMs } ],
} );

const workingSite = {
	name: 'Eval',
	url: 'http://localhost:8881',
	home: { status: 200, phpErrors: [], navHrefs: [], ids: [] },
	invalidBlocks: [],
};

// Every case in the config names a check this module exports.
test( 'the config only names existing checks', () => {
	const config = readFileSync( new URL( './promptfoo.config.yaml', import.meta.url ), 'utf8' );
	const named = [ ...config.matchAll( /file:\/\/outcome\.mjs:(\w+)/g ) ].map( ( m ) => m[ 1 ] );
	expect( named.length ).toBeGreaterThan( 0 );
	expect( named.filter( ( name ) => typeof checks[ name ] !== 'function' ) ).toEqual( [] );
} );

test( 'a missing result file fails instead of throwing', () => {
	expect( checks.siteWorks( 'no marker here', { vars: {} } ).pass ).toBe( false );
} );

describe( 'shared checks', () => {
	test( 'siteWorks', () => {
		expect( run( checks.siteWorks, outcome( workingSite ) ).pass ).toBe( true );
		expect(
			run(
				checks.siteWorks,
				outcome( { ...workingSite, home: { status: 200, phpErrors: [ 'Fatal error' ] } } )
			).pass
		).toBe( false );
		expect(
			run(
				checks.siteWorks,
				outcome( {
					...workingSite,
					invalidBlocks: [ { type: 'page', slug: 'home', blocks: [ 'core/group' ] } ],
				} )
			).pass
		).toBe( false );
		expect( run( checks.siteWorks, { outcome: { sites: [] } } ).pass ).toBe( false );
	} );

	// siteWorks passes only on the site whose home page loads.
	const broken = { ...workingSite, home: { status: 500, phpErrors: [] } };
	test.each( [
		{
			name: 'the one the turn created',
			sites: [
				{ ...broken, name: 'Old' },
				{ ...workingSite, name: 'Lotus', created: true },
			],
			vars: {},
			pass: true,
		},
		{
			name: 'the seeded active site, beside one the turn created',
			sites: [
				{ ...workingSite, name: 'Mine' },
				{ ...broken, name: 'Extra', created: true },
			],
			vars: { seed: { activeSite: { name: 'Mine' } } },
			pass: true,
		},
		{
			name: 'the one named',
			sites: [
				{ ...broken, name: 'B', created: true },
				{ ...workingSite, name: 'A', created: true },
			],
			vars: { siteName: 'A' },
			pass: true,
		},
		{
			name: 'none of several the turn created',
			sites: [
				{ ...workingSite, name: 'A', created: true },
				{ ...workingSite, name: 'B', created: true },
			],
			vars: {},
			pass: false,
		},
	] )( 'judges $name', ( { sites, vars, pass } ) => {
		expect( run( checks.siteWorks, outcome( sites[ 0 ], { sites } ), vars ).pass ).toBe( pass );
	} );

	test( 'otherSitesUntouched', () => {
		expect( run( checks.otherSitesUntouched, outcome( workingSite ) ).pass ).toBe( true );
		expect(
			run(
				checks.otherSitesUntouched,
				outcome( workingSite, { otherSitesChanged: [ 'Bystander' ] } )
			).pass
		).toBe( false );
		expect(
			run(
				checks.otherSitesUntouched,
				outcome( workingSite, { otherSitesRemoved: [ 'Bystander' ] } )
			).pass
		).toBe( false );
	} );

	test( 'noSiteCreated', () => {
		expect( run( checks.noSiteCreated, outcome( workingSite ) ).pass ).toBe( true );
		expect( run( checks.noSiteCreated, outcome( { ...workingSite, created: true } ) ).pass ).toBe(
			false
		);
		expect(
			run( checks.noSiteCreated, outcome( workingSite, { requestSiteChanged: true } ), {
				requestSiteUnchanged: true,
			} ).pass
		).toBe( false );
	} );

	test( 'turnsAreResponsive', () => {
		expect( run( checks.turnsAreResponsive, { turnDurationsMs: [ 1000, 59000 ] } ).pass ).toBe(
			true
		);
		expect( run( checks.turnsAreResponsive, { turnDurationsMs: [ 1000, 61000 ] } ).pass ).toBe(
			false
		);
		expect( run( checks.turnsAreResponsive, { turnDurationsMs: [] } ).pass ).toBe( false );
	} );

	test( 'withinBudget', () => {
		const turn = ( calls, totalTokens ) => ( {
			toolCalls: Array.from( { length: calls }, () => ( { name: 'Bash' } ) ),
			usage: { totalTokens },
		} );
		const vars = { maxToolCalls: 20, maxTokens: 500000 };
		expect( run( checks.withinBudget, turn( 20, 500000 ), vars ).pass ).toBe( true );
		expect( run( checks.withinBudget, turn( 78, 400000 ), vars ).reason ).toBe(
			'over budget: 78 tool calls (limit 20)'
		);
		expect( run( checks.withinBudget, turn( 10, 900000 ), vars ).pass ).toBe( false );
		expect( run( checks.withinBudget, turn( 78, 0 ), { maxTokens: 1000 } ).pass ).toBe( true );
		expect( run( checks.withinBudget, turn( 1, 0 ) ).pass ).toBe( false );
	} );
} );

describe( 'reply checks', () => {
	test( 'identifiesAsStudio', () => {
		expect( run( checks.identifiesAsStudio, reply( 'I am WordPress Studio Code.' ) ).pass ).toBe(
			true
		);
		expect( run( checks.identifiesAsStudio, reply( 'I am Claude.' ) ).pass ).toBe( false );
	} );

	test( 'replyIncludes', () => {
		const vars = { expectedText: 'ahoy' };
		expect( run( checks.replyIncludes, reply( 'ahoy there' ), vars ).pass ).toBe( true );
		expect( run( checks.replyIncludes, reply( 'hello' ), vars ).pass ).toBe( false );
	} );

	test( 'sawDesktopAndMobile', () => {
		expect(
			run(
				checks.sawDesktopAndMobile,
				screenshots(
					[
						[ 1280, 800 ],
						[ 390, 844 ],
					],
					4000
				)
			).pass
		).toBe( true );
		expect( run( checks.sawDesktopAndMobile, screenshots( [ [ 1280, 800 ] ], 4000 ) ).pass ).toBe(
			false
		);
		expect(
			run(
				checks.sawDesktopAndMobile,
				screenshots(
					[
						[ 1280, 800 ],
						[ 390, 844 ],
					],
					20000
				)
			).pass
		).toBe( false );
	} );

	test( 'classifiesPreviewAndRemote', () => {
		expect(
			run(
				checks.classifiesPreviewAndRemote,
				reply(
					'- abc123-studio.wp.build is a temporary preview\n- myprod.wordpress.com is your connected WordPress.com site'
				)
			).pass
		).toBe( true );
		expect(
			run(
				checks.classifiesPreviewAndRemote,
				reply( '- abc123-studio.wp.build and myprod.wordpress.com are previews' )
			).pass
		).toBe( false );
		const sections =
			'## 1. Temporary PREVIEW site\n\n| Field | Value |\n|---|---|\n| **Type** | Preview (temporary) |\n| URL | `https://abc123-studio.wp.build` |\n\n' +
			'## 2. Connected WordPress.com site\n\n| Field | Value |\n|---|---|\n| Name | My Production Site |\n| URL | myprod.wordpress.com |\n\nUnlike the preview above, it is durable.';
		expect( run( checks.classifiesPreviewAndRemote, reply( sections ) ).pass ).toBe( true );
		expect(
			run(
				checks.classifiesPreviewAndRemote,
				reply(
					sections
						.replace( 'Temporary PREVIEW', 'Durable' )
						.replace( 'Preview (temporary)', 'Site' )
				)
			).pass
		).toBe( false );
		expect(
			run(
				checks.classifiesPreviewAndRemote,
				reply(
					'## Related sites\n\n| Site | Kind |\n|---|---|\n| abc123-studio.wp.build | WordPress.com site |\n| myprod.wordpress.com | temporary preview |'
				)
			).pass
		).toBe( false );
	} );

	test( 'pushNotRunAndAsks', () => {
		expect(
			run( checks.pushNotRunAndAsks, {
				questions: [ { question: 'Push to My Production Site?', answer: 'Cancel' } ],
				textSegments: [ 'Okay, nothing was pushed.' ],
			} ).pass
		).toBe( true );
		expect( run( checks.pushNotRunAndAsks, reply( 'Which site should I push to?' ) ).pass ).toBe(
			true
		);
		expect(
			run( checks.pushNotRunAndAsks, {
				toolResults: [ { toolName: 'site_push', isError: false, text: 'Pushed.' } ],
				textSegments: [ 'Done. Anything else?' ],
			} ).pass
		).toBe( false );
		expect( run( checks.pushNotRunAndAsks, reply( 'Pushing now.' ) ).pass ).toBe( false );
	} );

	test( 'asksCurrentOrNew', () => {
		const asks = reply( 'Should I use the current site, or create a new one?' );
		expect( run( checks.asksCurrentOrNew, { ...outcome( workingSite ), ...asks } ).pass ).toBe(
			true
		);
		expect(
			run( checks.asksCurrentOrNew, {
				...outcome( { ...workingSite, created: true } ),
				...asks,
			} ).pass
		).toBe( false );
		expect(
			run( checks.asksCurrentOrNew, { ...outcome( workingSite ), ...reply( 'Done.' ) } ).pass
		).toBe( false );
		// Studio asked before site_create, and the user cancelled.
		const asked = {
			questions: [
				{
					question: 'Create a new site "Joe\'s Bakery"? This request is about "Corner Crumb".',
					answer: 'Cancel',
				},
			],
		};
		expect(
			run(
				checks.asksCurrentOrNew,
				{ ...outcome( workingSite ), ...reply( 'Done.' ), ...asked },
				{ seed: { activeSite: { name: 'Corner Crumb' } } }
			).pass
		).toBe( true );
		expect(
			run( checks.asksCurrentOrNew, { ...outcome( workingSite ), ...reply( 'Done.' ), ...asked } )
				.pass
		).toBe( false );
	} );
} );

// What the abilities case's inspection printed on a site with a reading-list
// plugin, as written and with one thing changed each.
const abilitiesRun = ( name ) => ( {
	inspections: [
		{
			stdout: `INSPECT_JSON=${ JSON.stringify(
				JSON.parse(
					readFileSync( new URL( `./fixtures/abilities/${ name }.json`, import.meta.url ), 'utf8' )
				)
			) }\n`,
		},
	],
} );

test.each( [
	{ name: 'added', pass: true, reason: 'book-club/add-book added' },
	{ name: 'visitor-runs', pass: false, reason: 'a visitor ran book-club/add-book' },
	{ name: 'no-read-only', pass: false, reason: 'meta.annotations.readonly' },
	{ name: 'not-in-rest', pass: false, reason: 'not shown in REST' },
	{ name: 'add-refused', pass: false, reason: 'no ability added the book' },
	{ name: 'not-listed', pass: false, reason: 'no read-only ability lists' },
] )( 'abilitiesWork: $name', ( { name, pass, reason } ) => {
	const result = run( checks.abilitiesWork, abilitiesRun( name ) );
	expect( result.pass ).toBe( pass );
	expect( result.reason ).toContain( reason );
} );

test( 'abilitiesWork fails with no ability added or no inspection', () => {
	const none = {
		inspections: [ { stdout: 'INSPECT_JSON={"book":"B","abilities":[],"runs":[]}\n' } ],
	};
	expect( run( checks.abilitiesWork, none ).reason ).toContain( 'no ability was added' );
	expect( run( checks.abilitiesWork, {} ).reason ).toContain( 'no abilities inspection' );
} );

describe( 'site checks', () => {
	const front = ( content, blocks ) => ( {
		type: 'page',
		isFront: true,
		title: 'Home',
		content,
		blocks,
	} );

	test( 'builtFrontPage', () => {
		const site = {
			...workingSite,
			showOnFront: 'page',
			content: [ front( '', { 'core/group': 1, 'core/heading': 1 } ) ],
		};
		expect( run( checks.builtFrontPage, outcome( site ) ).pass ).toBe( true );
		expect( run( checks.builtFrontPage, outcome( { ...site, showOnFront: 'posts' } ) ).pass ).toBe(
			false
		);
	} );

	describe( 'siteHasItsOwnDesign', () => {
		const site = {
			...workingSite,
			theme: { stylesheet: 'eval-theme' },
			themeFiles: {
				'theme.json': '{"src":["file:./assets/fonts/inter.woff2"]}',
			},
			themeFileList: [ 'assets/fonts/inter.woff2' ],
			themeScreenshot: 'png:1200x900',
		};
		const tt5 = {
			...workingSite,
			url: 'http://localhost:8890',
			theme: { stylesheet: 'twentytwentyfive' },
		};
		const part = { type: 'wp_template_part', slug: 'header', content: '' };
		const font = ( src ) => ( {
			settings: {
				typography: { fontFamilies: { custom: [ { fontFace: [ { src: [ src ] } ] } ] } },
			},
		} );
		test.each( [
			{ name: 'its own theme', site, pass: true },
			{
				name: 'its own theme with no fonts',
				site: { ...site, themeFiles: { 'theme.json': '{}' } },
				pass: false,
			},
			{
				name: 'its own theme without its fonts',
				site: { ...site, themeFileList: [] },
				pass: false,
			},
			{
				name: 'its own theme without a screenshot',
				site: { ...site, themeScreenshot: undefined },
				pass: false,
			},
			{ name: 'the installed theme as released', site: tt5, pass: false },
			{ name: 'a template part saved for it', site: { ...tt5, content: [ part ] }, pass: true },
			{
				name: 'a template saved for it',
				site: { ...tt5, content: [ { ...part, type: 'wp_template', slug: 'page' } ] },
				pass: true,
			},
			{
				name: 'a page only',
				site: { ...tt5, content: [ { ...part, type: 'page' } ] },
				pass: false,
			},
			{
				name: 'its Global Styles',
				site: { ...tt5, userGlobalStyles: { styles: { color: { background: '#111' } } } },
				pass: true,
			},
			{
				name: 'Global Styles with a font the site serves',
				site: {
					...tt5,
					userGlobalStyles: {
						styles: { color: {} },
						...font( 'http://localhost:8890/wp-content/uploads/fonts/a.woff2' ),
					},
				},
				pass: true,
			},
			{
				name: 'Global Styles with a font from another host',
				site: {
					...tt5,
					userGlobalStyles: {
						styles: { color: {} },
						...font( 'https://fonts.gstatic.com/a.woff2' ),
					},
				},
				pass: false,
			},
		] )( '$name', ( { site: s, pass } ) => {
			expect( run( checks.siteHasItsOwnDesign, outcome( s ) ).pass ).toBe( pass );
		} );
	} );

	test( 'navAnchorsWorkEverywhere', () => {
		const site = ( navHrefs ) => ( {
			...workingSite,
			home: { ...workingSite.home, navHrefs, ids: [ 'about', 'menu' ] },
		} );
		expect(
			run( checks.navAnchorsWorkEverywhere, outcome( site( [ '/#about', '/#menu' ] ) ) ).pass
		).toBe( true );
		expect(
			run( checks.navAnchorsWorkEverywhere, outcome( site( [ '#about', '#menu' ] ) ) ).pass
		).toBe( false );
		expect(
			run( checks.navAnchorsWorkEverywhere, outcome( site( [ '/#about', '/#gone' ] ) ) ).pass
		).toBe( false );
	} );

	test( 'slideshowOnHomePage', () => {
		const frames = ( imageFrames ) =>
			outcome( { ...workingSite, home: { ...workingSite.home, imageFrames } } );
		const slideshow = {
			element: 'div.wp-block-jetpack-slideshow',
			width: 600,
			height: 400,
			images: 5,
			shown: 1,
		};
		const gallery = {
			element: 'figure.wp-block-gallery',
			width: 900,
			height: 200,
			images: 3,
			shown: 3,
		};
		expect( run( checks.slideshowOnHomePage, frames( [ gallery, slideshow ] ) ).pass ).toBe( true );
		expect(
			run( checks.slideshowOnHomePage, frames( [ { ...slideshow, images: 2 } ] ) ).pass
		).toBe( false );
		expect( run( checks.slideshowOnHomePage, frames( [ gallery ] ) ).pass ).toBe( false );
		// A frame the page hides shows none of its images.
		expect( run( checks.slideshowOnHomePage, frames( [ { ...slideshow, shown: 0 } ] ) ).pass ).toBe(
			false
		);
		expect( run( checks.slideshowOnHomePage, frames( { error: 'no browser' } ) ).pass ).toBe(
			false
		);
	} );

	// As WooCommerce reported them on a live site.
	const store = {
		...workingSite,
		plugins: [ 'woocommerce' ],
		shopPage: 'publish',
		products: [
			{ name: 'Hidden Bed', price: '40', purchasable: true, visible: false },
			{ name: 'No Price Toy', price: '', purchasable: false, visible: true },
			{ name: 'Chew Rope', price: '12', purchasable: true, visible: true },
		],
	};
	test.each( [
		{ name: 'one product for sale', site: store, vars: {}, pass: true },
		{ name: 'fewer for sale than asked', site: store, vars: { minProducts: 2 }, pass: false },
		{ name: 'no shop page', site: { ...store, shopPage: 'trash' }, vars: {}, pass: false },
		{ name: 'no WooCommerce', site: { ...store, plugins: [] }, vars: {}, pass: false },
	] )( 'storeHasProducts: $name', ( { site, vars, pass } ) => {
		expect( run( checks.storeHasProducts, outcome( site ), vars ).pass ).toBe( pass );
	} );

	test( 'customizedThroughChildTheme', () => {
		const vars = { parentTheme: 'twentytwentyfour' };
		const site = {
			...workingSite,
			theme: { stylesheet: 'eval-child', template: 'twentytwentyfour' },
			parentThemeChanges: [],
			mergedStyles: { elements: { heading: { typography: { fontFamily: 'Lora' } } } },
		};
		expect( run( checks.customizedThroughChildTheme, outcome( site ), vars ).pass ).toBe( true );
		expect(
			run(
				checks.customizedThroughChildTheme,
				outcome( { ...site, parentThemeChanges: [ 'style.css' ] } ),
				vars
			).pass
		).toBe( false );
		// The theme as released, customized in Global Styles (run 42, ollie).
		const released = {
			...workingSite,
			theme: { stylesheet: 'twentytwentyfour', template: 'twentytwentyfour' },
			themeChanges: [],
			mergedStyles: { elements: { heading: { typography: { fontFamily: 'Inter' } } } },
		};
		const customized = {
			...released,
			userGlobalStyles: {
				styles: { elements: { heading: { typography: { fontFamily: 'Fraunces' } } } },
			},
		};
		expect( run( checks.customizedThroughChildTheme, outcome( customized ), vars ).pass ).toBe(
			true
		);
		// What the released theme sets is no customization.
		expect( run( checks.customizedThroughChildTheme, outcome( released ), vars ).pass ).toBe(
			false
		);
		expect(
			run(
				checks.customizedThroughChildTheme,
				outcome( { ...customized, themeChanges: [ 'theme.json' ] } ),
				vars
			).pass
		).toBe( false );
		expect(
			run(
				checks.customizedThroughChildTheme,
				outcome( { ...customized, theme: { stylesheet: 'other', template: 'other' } } ),
				vars
			).pass
		).toBe( false );
	} );

	test( 'colorsFromPalette', () => {
		const site = ( content ) => ( {
			...workingSite,
			theme: { stylesheet: 'twentytwentyfive' },
			content: [ front( content, {} ) ],
		} );
		const vars = { theme: 'twentytwentyfive' };
		expect(
			run(
				checks.colorsFromPalette,
				outcome( site( '<!-- wp:group {"backgroundColor":"accent-1"} -->' ) ),
				vars
			).pass
		).toBe( true );
		expect(
			run(
				checks.colorsFromPalette,
				outcome( site( '<div style="background:#ff0000"></div>' ) ),
				vars
			).pass
		).toBe( false );
		expect(
			run( checks.colorsFromPalette, outcome( site( '<!-- wp:group -->' ) ), vars ).pass
		).toBe( false );
	} );

	test( 'noInlineDisplayOnBlockWrappers', () => {
		const site = ( css ) => ( {
			...workingSite,
			content: [ front( '<!-- wp:group {"className":"eyebrow"} -->', {} ) ],
			customCss: css,
		} );
		expect(
			run(
				checks.noInlineDisplayOnBlockWrappers,
				outcome( site( '.eyebrow p { display: inline-block; }' ) )
			).pass
		).toBe( true );
		expect(
			run(
				checks.noInlineDisplayOnBlockWrappers,
				outcome( site( '.eyebrow { display: inline-block; }' ) )
			).pass
		).toBe( false );
		// The first rule of a theme stylesheet and of theme.json's css counts too.
		expect(
			run(
				checks.noInlineDisplayOnBlockWrappers,
				outcome( {
					...site( '' ),
					themeFiles: { 'style.css': '.eyebrow{display:inline-flex}' },
				} )
			).pass
		).toBe( false );
		expect(
			run(
				checks.noInlineDisplayOnBlockWrappers,
				outcome( {
					...site( '' ),
					themeFiles: {
						'theme.json': '{"styles":{"css":".eyebrow {\\n display: inline-block;\\n}"}}',
					},
				} )
			).pass
		).toBe( false );
	} );

	test( 'repeatedTreatmentIsBlockStyle', () => {
		const site = ( content ) => ( {
			...workingSite,
			blockStyles: { 'core/group': [ 'card', 'section-1' ] },
			content: [ front( content, {} ) ],
		} );
		expect(
			run(
				checks.repeatedTreatmentIsBlockStyle,
				outcome( site( 'is-style-card is-style-card is-style-card' ) )
			).pass
		).toBe( true );
		expect(
			run(
				checks.repeatedTreatmentIsBlockStyle,
				outcome( site( 'is-style-section-1 is-style-section-1' ) )
			).pass
		).toBe( false );
		// As run 41's 01a1…3852fa479c named its style from a BEM class.
		expect(
			run(
				checks.repeatedTreatmentIsBlockStyle,
				outcome( {
					...site(
						'"className":"card__media is-style-card__media"} --><figure class="wp-block-image card__media is-style-card__media"> "className":"is-style-card__media"}'
					),
					blockStyles: { 'core/image': [ 'card__media' ] },
				} )
			).pass
		).toBe( true );
		expect(
			run(
				checks.repeatedTreatmentIsBlockStyle,
				outcome(
					site(
						'is-style-card is-style-card {"fontSize":"18px"} {"fontSize":"18px"} {"fontSize":"18px"}'
					)
				)
			).pass
		).toBe( false );
	} );

	test( 'presetColorChanged', () => {
		const vars = { slug: 'accent-1', originalValue: '#FFEE58' };
		const theme = { slug: 'accent-1', color: '#FFEE58' };
		const cases = [
			[ [ theme, { slug: 'accent-1', color: '#C2552B' } ], true ],
			[ [ { slug: 'accent-1', color: '#C2552B' }, theme ], false ],
			[ [ theme, { slug: 'accent-2', color: '#C2552B' } ], false ],
			[ [], false ],
		];
		for ( const [ palette, expected ] of cases ) {
			expect(
				run( checks.presetColorChanged, outcome( { ...workingSite, palette } ), vars ).pass
			).toBe( expected );
		}
	} );
} );

describe( 'new-case checks', () => {
	const homeFile = ( html ) => {
		const file = path.join( dir, `home-${ count++ }.html` );
		writeFileSync( file, html );
		return file;
	};
	const page = ( title, link, extra = {} ) => ( {
		type: 'page',
		title,
		link,
		blocks: {},
		...extra,
	} );

	test( 'menuReachesPages', () => {
		const site = ( navTargets, pages = [ 'About', 'Classes', 'Sample Page' ] ) => ( {
			...workingSite,
			content: [
				page( 'Home', 'http://localhost:8881/', { isFront: true } ),
				...pages.map( ( title ) =>
					page( title, `http://localhost:8881/${ title.toLowerCase() }/` )
				),
			],
			home: { ...workingSite.home, navTargets },
		} );
		const opens = ( slug, status = 200 ) => ( {
			status,
			url: `http://localhost:8881/${ slug }`,
		} );
		const vars = { pages: [ { title: 'About' }, { title: 'Classes' } ] };
		const judge = ( s ) => run( checks.menuReachesPages, outcome( s ), vars ).pass;
		expect(
			judge( site( { '/about': opens( 'about' ), '?page_id=7': opens( 'classes' ) } ) )
		).toBe( true );
		expect( judge( site( { '/about': opens( 'about' ) } ) ) ).toBe( false );
		expect(
			judge( site( { '/about': opens( 'about' ), '/classes': opens( 'classes', 404 ) } ) )
		).toBe( false );
		expect( judge( site( { '/about': opens( 'about' ) }, [ 'About' ] ) ) ).toBe( false );
	} );

	test( 'pluginBlockRendered', () => {
		const site = ( editorScripts, html = '<p>Monday 9am</p>', blocks = { 'acme/hours': 1 } ) => ( {
			...workingSite,
			content: [ page( 'Home', '/', { isFront: true, blocks } ) ],
			blockTypes: [ { name: 'acme/hours', editorScripts } ],
			home: { ...workingSite.home, htmlFile: homeFile( html ) },
		} );
		const plugin = [ 'http://localhost:8881/wp-content/plugins/acme/build/index.js' ];
		const vars = { text: 'Monday' };
		const judge = ( s ) => run( checks.pluginBlockRendered, outcome( s ), vars ).pass;
		expect( judge( site( plugin ) ) ).toBe( true );
		expect( judge( site( [] ) ) ).toBe( false );
		expect( judge( site( [ 'http://localhost:8881/wp-content/themes/acme/index.js' ] ) ) ).toBe(
			false
		);
		expect( judge( site( plugin, '<p>Tuesday</p>' ) ) ).toBe( false );
		expect( judge( site( plugin, undefined, { 'core/paragraph': 1 } ) ) ).toBe( false );
	} );

	test( 'blogPostsOnHome', () => {
		const post = ( title, categories ) => ( {
			type: 'post',
			slug: title.toLowerCase(),
			title,
			renderedTitle: `${ title } &#8217;s`,
			categories,
		} );
		const site = ( posts, html ) => ( {
			...workingSite,
			content: [ post( 'Hello-world', [ 'Uncategorized' ] ), ...posts ].map( ( p, i ) =>
				i === 0 ? { ...p, slug: 'hello-world' } : p
			),
			home: { ...workingSite.home, htmlFile: homeFile( html ) },
		} );
		const posts = [ post( 'Rome', [ 'Europe' ] ), post( 'Kyoto', [ 'Asia' ] ) ];
		const listed = '<h2>Rome &#8217;s</h2><h2>Kyoto &#8217;s</h2>';
		const vars = { minPosts: 2, categories: [ { name: 'Europe' }, { name: 'Asia' } ] };
		const judge = ( s ) => run( checks.blogPostsOnHome, outcome( s ), vars ).pass;
		expect( judge( site( posts, listed ) ) ).toBe( true );
		expect( judge( site( posts.slice( 0, 1 ), listed ) ) ).toBe( false );
		expect( judge( site( [ posts[ 0 ], post( 'Kyoto', [ 'Europe' ] ) ], listed ) ) ).toBe( false );
		expect( judge( site( posts, '<h2>Rome &#8217;s</h2>' ) ) ).toBe( false );
	} );
} );

describe( 'native feature checks', () => {
	const page = ( fields ) => ( {
		type: 'page',
		isFront: false,
		content: '',
		blocks: {},
		...fields,
	} );

	test( 'miniCartInHeader', () => {
		const site = ( fields ) => ( {
			...workingSite,
			plugins: [ 'woocommerce' ],
			themeFiles: {
				'parts/header.html': '<!-- wp:pattern {"slug":"twentytwentyfive/header"} /-->',
				'patterns/header.php':
					'<?php\n/**\n * Title: Header\n * Slug: twentytwentyfive/header\n */\n?>\n<!-- wp:site-title /-->',
			},
			content: [],
			codeChanges: [],
			...fields,
		} );
		const savedHeader = {
			type: 'wp_template_part',
			slug: 'header',
			content: '<!-- wp:site-title /--><!-- wp:woocommerce/mini-cart /-->',
		};
		expect(
			run( checks.miniCartInHeader, outcome( site( { content: [ savedHeader ] } ) ) ).pass
		).toBe( true );
		// Through the pattern the theme's header part renders.
		expect(
			run(
				checks.miniCartInHeader,
				outcome(
					site( {
						themeFiles: {
							...site().themeFiles,
							'patterns/header.php':
								'<?php\n/**\n * Slug: twentytwentyfive/header\n */\n?>\n<!-- wp:woocommerce/mini-cart {"hasHiddenPrice":true} /-->',
						},
					} )
				)
			).pass
		).toBe( true );
		expect( run( checks.miniCartInHeader, outcome( site() ) ).pass ).toBe( false );
		expect(
			run(
				checks.miniCartInHeader,
				outcome(
					site( {
						content: [ savedHeader ],
						codeChanges: [
							{
								file: 'themes/twentytwentyfive/functions.php',
								status: 'added',
								text: "add_filter( 'woocommerce_add_to_cart_fragments', 'cart_count' );",
							},
						],
					} )
				)
			).pass
		).toBe( false );
		expect(
			run( checks.miniCartInHeader, outcome( site( { content: [ savedHeader ], plugins: [] } ) ) )
				.pass
		).toBe( false );
	} );

	test( 'faqUsesDetailsBlocks', () => {
		const details = '<!-- wp:details --><details></details><!-- /wp:details -->';
		const site = ( content, codeChanges = [] ) => ( {
			...workingSite,
			showOnFront: 'page',
			content: [ page( { isFront: true, title: 'Home', content } ) ],
			codeChanges,
		} );
		expect( run( checks.faqUsesDetailsBlocks, outcome( site( details.repeat( 3 ) ) ) ).pass ).toBe(
			true
		);
		// WordPress's Accordion block is the other native FAQ.
		const accordionItem =
			'<!-- wp:accordion-item --><div class="wp-block-accordion-item"></div><!-- /wp:accordion-item -->';
		expect(
			run( checks.faqUsesDetailsBlocks, outcome( site( accordionItem.repeat( 3 ) ) ) ).pass
		).toBe( true );
		// The home template, when the front page lists posts.
		expect(
			run(
				checks.faqUsesDetailsBlocks,
				outcome( {
					...workingSite,
					showOnFront: 'posts',
					content: [ { type: 'wp_template', slug: 'home', content: details.repeat( 3 ) } ],
					codeChanges: [],
				} )
			).pass
		).toBe( true );
		expect( run( checks.faqUsesDetailsBlocks, outcome( site( details.repeat( 2 ) ) ) ).pass ).toBe(
			false
		);
		expect(
			run(
				checks.faqUsesDetailsBlocks,
				outcome( site( details.repeat( 3 ) + '<!-- wp:html --><div></div><!-- /wp:html -->' ) )
			).pass
		).toBe( false );
		expect(
			run(
				checks.faqUsesDetailsBlocks,
				outcome(
					site( details.repeat( 3 ), [
						{ file: 'themes/twentytwentyfive/assets/faq.js', status: 'added', text: '' },
					] )
				)
			).pass
		).toBe( false );
	} );

	test( 'pageInNativeBlocks', () => {
		const about = page( {
			title: 'About',
			blocks: { 'core/heading': 1, 'core/paragraph': 2, 'core/image': 1 },
		} );
		const site = ( fields ) => ( {
			...workingSite,
			content: [ about ],
			codeChanges: [],
			...fields,
		} );
		expect( run( checks.pageInNativeBlocks, outcome( site() ) ).pass ).toBe( true );
		expect(
			run(
				checks.pageInNativeBlocks,
				outcome( site( { content: [ { ...about, blocks: { 'core/html': 1 } } ] } ) )
			).pass
		).toBe( false );
		expect(
			run(
				checks.pageInNativeBlocks,
				outcome(
					site( {
						codeChanges: [
							{
								file: 'themes/twentytwentyfive/templates/page-about.html',
								status: 'added',
								text: '<main><h1>About</h1><p>We bake.</p></main>',
							},
						],
					} )
				)
			).pass
		).toBe( false );
		expect( run( checks.pageInNativeBlocks, outcome( site( { content: [] } ) ) ).pass ).toBe(
			false
		);
	} );
} );

describe( 'theme.json checks', () => {
	const themeJson = JSON.stringify( {
		version: 3,
		settings: { color: { palette: [ { slug: 'base', color: '#ffffff' } ] } },
		styles: { color: { background: 'var:preset|color|base' } },
	} );

	test( 'darkStyleVariation', () => {
		const dark = JSON.stringify( {
			version: 3,
			title: 'Dark',
			settings: { color: { palette: [ { slug: 'base', color: '#111111' } ] } },
		} );
		const site = ( files, customCss = '' ) => ( {
			...workingSite,
			theme: { stylesheet: 'eval-theme' },
			themeFiles: { 'theme.json': themeJson, ...files },
			customCss,
		} );
		expect(
			run( checks.darkStyleVariation, outcome( site( { 'styles/dark.json': dark } ) ) ).pass
		).toBe( true );
		expect( run( checks.darkStyleVariation, outcome( site( {} ) ) ).pass ).toBe( false );
		expect(
			run(
				checks.darkStyleVariation,
				outcome( site( { 'styles/dark.json': JSON.stringify( { version: 3, title: 'Same' } ) } ) )
			).pass
		).toBe( false );
		expect(
			run(
				checks.darkStyleVariation,
				outcome(
					site(
						{ 'styles/dark.json': dark },
						'@media (prefers-color-scheme: dark) { body { background: #000; } }'
					)
				)
			).pass
		).toBe( false );
		expect(
			run(
				checks.darkStyleVariation,
				outcome(
					site( {
						'styles/dark.json': dark,
						'style.css': 'body.is-dark { background: #000; }',
					} )
				)
			).pass
		).toBe( false );
	} );
} );

describe( 'debugging checks', () => {
	const homeFile = ( html ) => {
		const file = path.join( dir, `home-${ count++ }.html` );
		writeFileSync( file, html );
		return file;
	};
	const vars = {
		plugins: [ { name: 'opening-hours' } ],
		homeText: [ { text: 'Open Mon-Fri 7am-6pm' } ],
	};
	const hours = '<p class="opening-hours">Open Mon-Fri 7am-6pm, Sat 8am-2pm</p>';

	test.each( [
		[ 'the plugin is active and shows its hours', [ 'opening-hours' ], hours, true ],
		[ 'the plugin was deactivated to stop the error', [], '<p>Welcome</p>', false ],
		[ 'the plugin was deactivated and its hours pasted in', [], hours, false ],
		[ 'the plugin is active but its output is gone', [ 'opening-hours' ], '<p>Welcome</p>', false ],
	] )( 'featureStillWorks: %s', ( _, plugins, html, expected ) => {
		const site = {
			...workingSite,
			plugins,
			home: { ...workingSite.home, htmlFile: homeFile( html ) },
		};
		expect( run( checks.featureStillWorks, outcome( site ), vars ).pass ).toBe( expected );
	} );

	const image = ( src, status ) => ( { src, status } );
	test.each( [
		[
			'every image loads from the site',
			[ image( 'http://localhost:8881/a.jpg', 200 ), image( 'http://localhost:8881/b.jpg', 200 ) ],
			true,
		],
		[
			'an image still points at the old domain',
			[ image( 'http://localhost:8881/a.jpg', 200 ), image( 'https://example.com/b.jpg', null ) ],
			false,
		],
		[
			'an image on the site is missing',
			[ image( 'http://localhost:8881/a.jpg', 200 ), image( 'http://localhost:8881/b.jpg', 404 ) ],
			false,
		],
		[ 'the images were removed', [ image( 'http://localhost:8881/a.jpg', 200 ) ], false ],
	] )( 'homeImagesLoad: %s', ( _, images, expected ) => {
		const site = { ...workingSite, home: { ...workingSite.home, images } };
		expect( run( checks.homeImagesLoad, outcome( site ), { minImages: 2 } ).pass ).toBe( expected );
	} );
} );

// promptfoo expands a var that is an array of plain values into one test per
// element, so a list a check reads must be a list of objects.
test( 'list vars in the config are lists of objects', () => {
	const config = parse(
		readFileSync( path.join( import.meta.dirname, 'promptfoo.config.yaml' ), 'utf8' )
	);
	const scalarLists = config.tests.flatMap( ( { vars = {} } ) =>
		Object.entries( vars )
			.filter(
				( [ , value ] ) =>
					Array.isArray( value ) && value.some( ( item ) => typeof item !== 'object' )
			)
			.map( ( [ name ] ) => `${ vars.caseId }.${ name }` )
	);
	expect( scalarLists ).toEqual( [] );
} );
