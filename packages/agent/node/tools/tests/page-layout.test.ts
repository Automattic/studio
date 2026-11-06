import { existsSync } from 'fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	pageContrast,
	pageHeaderWraps,
	pageLayout,
	pageSticky,
	pageTextFit,
	pageWideTextBreaks,
} from '@studio/agent/node/tools/page-layout';

type Browser = Awaited< ReturnType< typeof chromium.launch > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

// A real browser lays the page out, wherever Playwright's Chromium is installed.
describe.runIf( existsSync( chromium.executablePath() ) )( 'the page layout', () => {
	let browser: Browser;
	beforeAll( async () => {
		browser = await chromium.launch();
	} );
	afterAll( () => browser.close() );

	const open = async < T >( body: string, read: ( page: Page ) => Promise< T > ) => {
		const page = await browser.newPage( { viewport: { width: 1000, height: 800 } } );
		await page.setContent( `<style>body,h1,p{margin:0}</style><body>${ body }</body>` );
		try {
			return await read( page );
		} finally {
			await page.close();
		}
	};
	const textFitOf = async ( body: string ) => {
		const { edges, breaks } = await open( body, pageTextFit );
		return [ ...edges, ...breaks ];
	};

	const layoutOf = ( body: string ) => open( body, pageLayout );

	it( "states where each region and main's blocks render, past a wrapper", async () => {
		expect(
			await layoutOf( `<div class="wp-site-blocks">
				<header class="wp-block-template-part"><div class="wp-block-group" style="display:flex;justify-content:space-between;align-items:flex-start"><p class="wp-block-site-title" style="height:80px;width:200px;margin:0"></p><nav class="wp-block-navigation" style="height:40px;width:300px"></nav></div></header>
				<main class="wp-block-group is-layout-flow"><div class="wp-block-group">
					<section id="hero" class="wp-block-cover poster has-base-color" style="height:600px"><div class="wp-block-cover__inner-container"><h1 style="height:60px"></h1><p style="height:40px"></p></div></section>
					<section class="wp-block-group wp-container-core-group-is-layout-1" style="height:300px;width:500px;margin-left:250px"></section>
					<section style="display:none;height:50px"></section>
				</div></main>
				<footer style="height:100px"></footer>
			</div>` )
		).toEqual( [
			'header.wp-block-template-part: y 0–80 (80px tall), x 0–1000',
			'  p.wp-block-site-title: y 0–80 (80px tall), x 0–200',
			'  nav.wp-block-navigation: y 0–40 (40px tall), x 700–1000',
			'main.wp-block-group: y 80–980 (900px tall), x 0–1000',
			'  section#hero.wp-block-cover.poster: y 80–680 (600px tall), x 0–1000',
			'  section.wp-block-group: y 680–980 (300px tall), x 250–750',
			'footer: y 980–1080 (100px tall), x 0–1000',
		] );
	} );

	// The shapes of eval18's footers, asked to center everything: a site title
	// aligned as a block, not as text; centered text in a column the layout
	// leaves on the left; an icon and its text centered as one row.
	it.each( [
		{
			name: 'text centered in its group, and a title that is not',
			block: `<p style="text-align:center">Gentle care</p><p style="text-align:center">Visit <a href="/">us</a></p><p>Brightside</p>`,
			text: 'text 1 left, 2 centered ("Brightside" Npx left)',
		},
		{
			name: 'centered text in a column the flex layout leaves at the start',
			block: `<div style="display:flex;flex-direction:column;align-items:flex-start;text-align:center"><div style="display:flex;gap:20px"><p style="width:200px">Visit us</p><p style="width:200px">Hours</p></div></div>`,
			text: 'text 2 left',
		},
		{
			name: 'an icon and its text centered together as a row',
			block: `<p style="display:flex;justify-content:center;gap:8px"><span style="font-size:30px">*</span> 128 Brightside Way</p>`,
			text: 'text 1 centered',
		},
		{
			name: 'a left paragraph whose long lines span the block',
			block: `<p>${ 'Gentle care for the whole family '.repeat( 8 ) }</p>`,
			text: 'text 1 left',
		},
	] )( 'says where the text of a block sits: $name', async ( { block, text } ) => {
		const layout = await layoutOf(
			`<div class="wp-site-blocks"><footer><div class="wp-block-group" style="display:flow-root;width:1000px">${ block }</div><div></div></footer></div>`
		);
		// After the block's box; the px a text is off by is its font's, so any.
		expect( layout[ 1 ].split( '; ' )[ 1 ].replace( /\d+px/, 'Npx' ) ).toBe( text );
	} );

	it( "names the page's background where it shows between full-width blocks", async () => {
		const gap = ':where(.wp-site-blocks) > * + *, .is-layout-flow > * + * { margin-top: 24px }';
		const layout = await layoutOf( `<style>${ gap }</style><div class="wp-site-blocks">
			<header class="wp-block-template-part"><div class="wp-block-group" style="background:#10111a;height:90px"></div></header>
			<main class="wp-block-group is-layout-flow">
				<div class="wp-block-group alignfull hero" style="background:#10111a;height:500px"></div>
				<div class="wp-block-group alignfull stats" style="background:#2743c4;height:200px"></div>
				<div class="wp-block-group alignfull" style="padding:40px 0"><div class="card" style="background:#2743c4;height:160px"></div></div>
				<div class="wp-block-group alignfull" style="background:#10111a;height:200px"></div>
				<div class="wp-block-group" style="max-width:600px;margin-inline:auto;height:300px"></div>
				<div class="wp-block-group alignfull band" style="background:#2743c4;height:200px"></div>
			</main>
		</div>` );
		// Not where the page's color meets the gap, as past a block's padding, which reads as its own space,
		// nor across a narrower block between two, which port eval24 redo run 1 read as a 1856px strip.
		expect(
			layout.filter( ( line ) => line.includes( 'background' ) || line.startsWith( '  y' ) )
		).toEqual( [
			"The page's background shows as a strip between full-width blocks, the top margin WordPress gives each block after the first in a layout from its block gap (wp_get_layout_style() in wp-includes/block-supports/layout.php; for the header, main and footer, :where(.wp-site-blocks) > * in WP_Theme_JSON::get_root_layout_rules()):",
			'  y 90–114 (24px), between header.wp-block-template-part and main.wp-block-group',
			'  y 614–638 (24px), between div.wp-block-group.alignfull.hero and div.wp-block-group.alignfull.stats',
		] );
	} );

	// The shapes of eval19's headers, in a 1000px viewport: a flex row of title,
	// navigation and button, as WordPress lays out a flex group and the
	// navigation's links, wrapping those that do not fit.
	const flex = 'display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center';
	const nav = `<nav class="wp-block-navigation"><ul class="wp-block-navigation__container" style="display:flex;flex-wrap:wrap;gap:28px;margin:0;padding:0;list-style:none">${ [
		'Home',
		'Services',
		'About',
		'Contact',
	]
		.map( ( link ) => `<li><a style="font-size:20px">${ link }</a></li>` )
		.join( '' ) }</ul></nav>`;
	const button = ( width: number ) =>
		`<div class="wp-block-buttons"><a class="wp-block-button__link" style="display:block;width:${ width }px">Book Appointment</a></div>`;
	it.each( [
		{
			name: 'one that fits',
			row: `<div class="wp-block-group" style="${ flex }"><p class="wp-block-site-title" style="width:300px">Brightside</p>${ nav }${ button(
				180
			) }</div>`,
			lines: [],
		},
		{
			// Branch run 5.
			name: 'a button that does not fit',
			row: `<div class="wp-block-group" style="${ flex }"><p class="wp-block-site-title" style="width:520px">Brightside Family Dental</p>${ nav }${ button(
				220
			) }</div>`,
			lines: [
				'The header\'s div.wp-block-group lays its 3 items out in a row, 1000px wide, and they take 2 lines: "Book Appointment" starts a line of its own, as the row wraps the items that do not fit.',
			],
		},
		{
			// Branch run 2: a row that does not wrap squeezes the navigation, whose links do.
			name: 'a navigation squeezed by a row that does not wrap',
			row: `<div class="wp-block-group" style="${ flex };flex-wrap:nowrap"><p class="wp-block-site-title" style="flex-shrink:0;width:520px">Brightside Family Dental</p>${ nav }<div style="flex-shrink:0">${ button(
				220
			) }</div></div>`,
			lines: [
				'The header\'s ul.wp-block-navigation__container lays its 4 items out in a row, 260px wide, and they take 2 lines: "Contact" starts a line of its own, as the row wraps the items that do not fit.',
			],
		},
		{
			name: 'a centered title above its navigation, which is no row',
			row: `<div class="wp-block-group" style="text-align:center"><p class="wp-block-site-title">Brightside</p>${ nav }</div>`,
			lines: [],
		},
	] )( 'names the rows of the header that wrap: $name', async ( { row, lines } ) => {
		expect(
			await open(
				`<div class="wp-site-blocks"><header class="wp-block-template-part">${ row }</header><main style="display:flex;flex-wrap:wrap"><p style="width:600px">a</p><p style="width:600px">b</p></main></div>`,
				pageHeaderWraps
			)
		).toEqual( lines );
	} );

	it( 'says when the page is wider than its viewport, and what reaches past it', async () => {
		expect(
			await layoutOf( `<footer class="wp-block-template-part" style="height:20px"><div style="width:300px">
				<div class="wp-block-group footer-grid" style="width:1400px;height:10px"><p style="height:5px"></p></div>
				<div style="overflow:hidden"><div style="width:1600px;height:5px"></div></div>
				<div style="position:fixed;left:1200px;width:900px;height:5px"></div>
				<div class="bleed" style="margin-left:-40px;width:300px;height:5px"></div>
			</div></footer>` )
		).toEqual( [
			'footer.wp-block-template-part: y 0–20 (20px tall), x 0–1000',
			'  div.wp-block-group.footer-grid: y 0–10 (10px tall), x 0–1400',
			'  div: y 10–15 (5px tall), x 0–300',
			'  div: y 15–20 (5px tall), x 1200–2100',
			'  div.bleed: y 15–20 (5px tall), x -40–260',
			'The page is 1400px wide in a 1000px viewport, so it scrolls sideways.',
			'  div.wp-block-group.footer-grid reaches past it, x 0–1400, in footer.wp-block-template-part.',
		] );
	} );

	// As run h2h5's furniture site on mobile: one of several links, with no class of its own.
	it( 'names an element with no class of its own by its text', async () => {
		expect(
			(
				await layoutOf( `<main class="wp-block-group" style="height:20px"><p style="width:300px">
				<a href="#">See the pieces</a>
				<a href="#" style="display:inline-block;width:170px;margin-left:900px">Commission a piece</a>
			</p></main>` )
			).slice( -1 )
		).toEqual( [
			'  a "Commission a piece" reaches past it, x 900–1070, in main.wp-block-group.',
		] );
	} );

	// As run h2h5's climbing gym footer: an email that does not wrap in its column.
	// Text past the page's start edge widens nothing, as the page does not scroll there.
	it( 'names text that spills past its box when no box does', async () => {
		expect(
			(
				await layoutOf( `<footer style="height:20px"><div style="width:180px;margin-left:800px;font:20px/1 monospace">
				<p class="wp-block-paragraph">hello@climbinggym.com<br>Open daily</p>
				<p style="overflow:hidden">clipped@nowhere.example</p>
				<p style="text-indent:-900px">before@its.start</p>
			</div></footer>` )
			).slice( -2 )
		).toEqual( [
			'The page is 1052px wide in a 1000px viewport, so it scrolls sideways.',
			'  The text "hello@climbinggym.com" of p.wp-block-paragraph reaches past it, x 800–1052, wider than its 180px box, as the browser does not wrap it there, in footer.',
		] );
	} );

	it( 'counts the regions past its limit', async () => {
		const layout = await layoutOf( '<p style="height:5px"></p>'.repeat( 45 ) );
		expect( layout ).toHaveLength( 41 );
		expect( layout.at( -1 ) ).toBe( '…and 5 more' );
	} );

	it.each< [ string, string, string[] ] >( [
		[
			'a word wider than its column, which core lets the browser break',
			'<div class="wp-block-column" style="width:200px;margin-left:100px;word-break:break-word;overflow-wrap:break-word"><h1 class="wp-block-heading" style="font:40px/1 monospace;padding:0 10px">Everything fits</h1></div>',
			[
				'h1.wp-block-heading: the browser breaks "Everything" across lines, as the word (240px) is wider than its box (180px).',
			],
		],
		[
			'an email address wider than its column, by the whole address',
			'<p style="width:156px;margin-left:100px;overflow-wrap:break-word;font:12px/1 monospace">hello@pawswhiskers.shop</p>',
			[
				'p: the browser breaks "hello@pawswhiskers.shop" across lines, as the word (166px) is wider than its box (156px).',
			],
		],
		[
			'a word the page hyphenates',
			'<div lang="en" style="width:200px;margin-left:100px;word-break:break-word;hyphens:auto"><h1 style="font:40px/1 monospace">Everything</h1></div>',
			[],
		],
		[
			'words that wrap whole',
			'<p style="width:200px;margin-left:100px;font:20px/1 monospace">Every word here wraps whole</p>',
			[],
		],
		[
			'text against the left edge, and the right',
			'<p class="tagline" style="font:20px/1 monospace">Left<br>Again</p><p style="text-align:right;font:20px/1 monospace">Right</p>',
			[
				'p.tagline "Left Again": its text starts at the viewport\'s left edge (x 0).',
				'p "Right": its text ends at the viewport\'s right edge (x 1000).',
			],
		],
		// As every theme of run h2h5 that left styles.spacing.padding unset.
		[
			"text against the edge of a block theme's page with core's 0px root padding",
			'<style>body{padding:0px;--wp--style--root--padding-left:0px}</style><div class="wp-site-blocks"><p class="tagline" style="font:20px/1 monospace">Left</p></div>',
			[
				"The theme's styles.spacing.padding, the padding WordPress puts between the page's content and the viewport's edges, is core's 0px (wp-includes/theme.json); with settings.useRootPaddingAwareAlignments true, WordPress applies it inside each .has-global-padding container, so full-width blocks still reach the edges (get_root_layout_rules() in wp-includes/class-wp-theme-json.php).",
				'p.tagline "Left": its text starts at the viewport\'s left edge (x 0).',
			],
		],
		[
			"text against the edge of a block theme's page with root padding, as a full-width block reaches it",
			'<style>body{--wp--style--root--padding-left:24px;--wp--style--root--padding-right:24px}</style><div class="wp-site-blocks"><p class="tagline" style="font:20px/1 monospace">Left</p></div>',
			[ 'p.tagline "Left": its text starts at the viewport\'s left edge (x 0).' ],
		],
		[
			'text a visitor does not see, as screen-reader-text clips it',
			'<a class="screen-reader-text" style="position:absolute;left:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Skip to content</a>',
			[],
		],
		[
			'text inside the page padding',
			'<div style="padding:0 24px;font:20px/1 monospace"><p>Padded</p><p style="text-align:right">Padded</p></div>',
			[],
		],
	] )( 'states %s', async ( _name, body, lines ) => {
		expect( await textFitOf( body ) ).toEqual( lines );
	} );

	// eval20 picky port 2: a heading's "service" fit its column on the 1040px
	// desktop, and broke at 1280px, as its fluid size grew and the column did not.
	it( 'names the words that break where fluid font sizes are largest', async () => {
		const column = ( word: string ) =>
			`<h3 style="flex:1;min-width:0;overflow-wrap:break-word;font:900 clamp(25px, 1.563rem + ((1vw - 3.2px) * 1.93), 42px) sans-serif">${ word }</h3>`;
		const lines = await open(
			`<div style="display:flex;gap:24px;max-width:720px;margin:auto">${ [
				'Tune',
				'Brakes',
				'Wheels',
				'Services',
			]
				.map( column )
				.join( '' ) }</div>`,
			async ( page ) => [
				...( await pageTextFit( page ) ).breaks,
				...( await pageWideTextBreaks( page ) ),
				`${ page.viewportSize()?.width }`,
			]
		);
		expect( lines.map( ( line ) => line.replace( /\d+px\)/g, 'Npx)' ) ) ).toEqual( [
			expect.stringMatching( /^At 1600px wide, where WordPress's fluid font sizes have grown/ ),
			'  h3: the browser breaks "Services" across lines, as the word (Npx) is wider than its box (Npx).',
			'1000',
		] );
	} );

	it( 'counts the lines past its limit', async () => {
		const lines = await textFitOf(
			Array.from( { length: 12 }, ( _, i ) => `<p class="p${ i }">x</p>` ).join( '' )
		);
		expect( lines ).toHaveLength( 11 );
		expect( lines.at( -1 ) ).toBe( '…and 2 more' );
	} );

	// eval7 picky 1: a theme's `html { scroll-behavior: smooth }` left text
	// below the first screen unread, as a scroll to it had not moved yet.
	// eval23 redo port 2: outlined text (a transparent fill, a stroke) shows its stroke.
	it.each( [ '', 'html{scroll-behavior:smooth}' ] )(
		'names text a visitor cannot read against what is painted behind it (%s)',
		async ( smooth ) => {
			const lines = await open(
				`<style>${ smooth } body{color:#0b1633} h1,h2{color:#0b1633} .tall{height:2000px}</style>
			<div class="wp-block-group has-background" style="background:#0b1633"><p>Readable?</p></div>
			<div class="tall"></div>
			<div class="wp-block-group has-text-color has-background" style="background:#0b1633;color:#fff"><h2>Below the fold</h2><p>White</p></div>
			<div style="background:linear-gradient(#0b1633,#0b1633)"><p style="color:#fff">Over a gradient</p></div>
			<div style="position:relative"><span style="position:absolute;inset:0;background:#0b1633"></span><p style="position:relative;color:#fff">Over an overlay</p></div>
			<p style="color:rgba(11,22,51,.35)">Faded</p>
			<div class="wp-block-group has-text-color has-background" style="background:#0b1633;color:#1a2540"><p>Dim</p></div>
			<div style="background:#0b1633"><p style="color:transparent;-webkit-text-stroke:1px #c6e24b">Outlined</p><p style="color:transparent;-webkit-text-stroke:1px #1a2540">Outlined dim</p></div>`,
				pageContrast
			);
			expect( lines ).toEqual( [
				'Text a visitor cannot read, under the 3:1 contrast WCAG 2 asks of large text (4.5:1 of other text; success criterion 1.4.3):',
				'  p "Readable?", at y 0, is #0b1633 text on #0b1633, a contrast ratio of 1.0:1. The background is div.wp-block-group\'s, a block with a background color (has-background) and no text color of its own (has-text-color).',
				'  h2 "Below the fold", at y 2038, is #0b1633 text on #0b1633, a contrast ratio of 1.0:1. Its section sets the text color #ffffff, which the heading does not take: a heading color in theme.json (styles.elements.heading, styles.elements.h2 or styles.blocks.core/heading) is a rule on the heading itself, which wins over the color it would inherit.',
				'  p "Faded", at y 2140, is #aaaeb8 text on #ffffff, a contrast ratio of 2.2:1.',
				'  p "Dim", at y 2158, is #1a2540 text on #0b1633, a contrast ratio of 1.2:1.',
				'  p "Outlined dim", at y 2194, is #1a2540 text on #0b1633, a contrast ratio of 1.2:1.',
			] );
		}
	);

	it( 'names a sticky element its parent is too short to let stick', async () => {
		expect(
			await open(
				`<header class="wp-block-template-part"><div class="wp-block-group site-header has-background" style="position:sticky;top:0;height:80px"></div></header>
				<div class="tall" style="height:1000px"><nav class="toc" style="position:sticky;top:0;height:40px"></nav></div>
				<header class="wp-block-template-part" style="position:sticky;top:0"><div class="site-header" style="height:80px"></div></header>
				<div class="row" style="height:40px"><aside class="pin" style="position:sticky;top:10px;height:40px"></aside></div>
				<div style="height:60px"><p style="position:sticky;top:0;height:40px"></p></div>
				<div style="height:40px"><span style="display:block;position:relative;top:0;height:40px"></span></div>
				<div style="height:40px"><footer style="position:sticky;bottom:0;height:40px"></footer></div>`,
				pageSticky
			)
		).toEqual( [
			"`div.wp-block-group.site-header` is position: sticky inside `header.wp-block-template-part`, a wrapper exactly its height, so it scrolls away with that wrapper: a sticky element sticks within its parent's box. WordPress wraps each template part in that element, so the wrapper is the one to make sticky.",
			"`aside.pin` is position: sticky inside `div.row`, a wrapper exactly its height, so it scrolls away with that wrapper: a sticky element sticks within its parent's box.",
		] );
	} );
} );
