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
					question:
						'Create a new site "Joe\'s Bakery"? This request is about "Eval Active Site Two".',
					answer: 'Cancel',
				},
			],
		};
		expect(
			run( checks.asksCurrentOrNew, { ...outcome( workingSite ), ...reply( 'Done.' ), ...asked } )
				.pass
		).toBe( true );
	} );
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

	test( 'ownThemeWithFontsAndScreenshot', () => {
		const site = {
			...workingSite,
			theme: { stylesheet: 'eval-theme' },
			themeFiles: {
				'theme.json': '{"src":["file:./assets/fonts/inter.woff2"]}',
			},
			themeFileList: [ 'assets/fonts/inter.woff2' ],
			themeScreenshot: 'png:1200x900',
		};
		expect( run( checks.ownThemeWithFontsAndScreenshot, outcome( site ) ).pass ).toBe( true );
		expect(
			run(
				checks.ownThemeWithFontsAndScreenshot,
				outcome( { ...site, theme: { stylesheet: 'twentytwentyfive' } } )
			).pass
		).toBe( false );
		expect(
			run( checks.ownThemeWithFontsAndScreenshot, outcome( { ...site, themeFileList: [] } ) ).pass
		).toBe( false );
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

	test( 'pluginBlockOnFrontPage', () => {
		const vars = { plugin: 'jetpack', blockPrefix: 'jetpack/' };
		const site = ( plugins, blocks ) => ( {
			...workingSite,
			plugins,
			content: [ front( '', blocks ) ],
		} );
		expect(
			run(
				checks.pluginBlockOnFrontPage,
				outcome( site( [ 'jetpack' ], { 'jetpack/slideshow': 1 } ) ),
				vars
			).pass
		).toBe( true );
		expect(
			run(
				checks.pluginBlockOnFrontPage,
				outcome( site( [ 'jetpack' ], { 'core/gallery': 1 } ) ),
				vars
			).pass
		).toBe( false );
		expect(
			run( checks.pluginBlockOnFrontPage, outcome( site( [], { 'jetpack/slideshow': 1 } ) ), vars )
				.pass
		).toBe( false );
	} );

	test( 'storeHasProducts', () => {
		const site = { ...workingSite, plugins: [ 'woocommerce' ], products: 3 };
		expect( run( checks.storeHasProducts, outcome( site ) ).pass ).toBe( true );
		expect( run( checks.storeHasProducts, outcome( { ...site, products: 0 } ) ).pass ).toBe(
			false
		);
		expect( run( checks.storeHasProducts, outcome( { ...site, plugins: [] } ) ).pass ).toBe(
			false
		);
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
		expect(
			run(
				checks.customizedThroughChildTheme,
				outcome( {
					...site,
					theme: { stylesheet: 'twentytwentyfour', template: 'twentytwentyfour' },
				} ),
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

	test( 'designTokenReachedTheme', () => {
		const vars = { token: 'primary', originalValue: '#000000' };
		const site = ( designMd, palette ) => ( { ...workingSite, designMd, palette } );
		expect(
			run(
				checks.designTokenReachedTheme,
				outcome( site( 'primary: "#2255aa"', [ { color: '#2255AA' } ] ) ),
				vars
			).pass
		).toBe( true );
		expect(
			run(
				checks.designTokenReachedTheme,
				outcome( site( 'primary: "#2255aa"', [ { color: '#000000' } ] ) ),
				vars
			).pass
		).toBe( false );
		expect(
			run(
				checks.designTokenReachedTheme,
				outcome( site( 'primary: "#000000"', [ { color: '#000000' } ] ) ),
				vars
			).pass
		).toBe( false );
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

describe( 'routing checks', () => {
	const skill = ( name ) => ( { name: 'Skill', input: { name } } );
	const vars = { skills: [ { name: 'block-content' }, { name: 'imagery' } ] };

	test( 'skillsLoadedFirst', () => {
		const calls = [ skill( 'block-content' ), { name: 'Write', input: {} }, skill( 'imagery' ) ];
		expect(
			run(
				checks.skillsLoadedFirst,
				{ toolCalls: calls, stoppedAt: { toolName: 'Write', index: 1 } },
				vars
			).pass
		).toBe( false );
		expect(
			run(
				checks.skillsLoadedFirst,
				{ toolCalls: [ skill( 'imagery' ), ...calls ], stoppedAt: { toolName: 'Write', index: 2 } },
				vars
			).pass
		).toBe( true );
		expect( run( checks.skillsLoadedFirst, { toolCalls: calls }, vars ).pass ).toBe( true );
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
