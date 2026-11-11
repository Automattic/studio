import { execFile, spawn } from 'child_process';
import {
	appendFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blockEditorScripts } from '@studio/agent/node/block-editor-scripts';
import {
	createBlockValidationGate,
	rendersAlikeOn,
	validateBlockMarkup,
	validateBlockMarkupFile,
} from '@studio/agent/node/block-validation-gate';
import {
	bindNavigationLinks,
	blocksSavingElements,
	cleanupValidatorPages,
	dropCommentsBetweenBlocks,
	insertedTemplates,
	storePresetValues,
	unregisteredInEditor,
	validateBlocks,
} from '@studio/agent/node/block-validator';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { validateHtmlBlockPolicy } from '@studio/agent/shared/block-content-policy';
import type { HostSite, StudioAgentHost } from '@studio/agent/shared/host';
import type { ChildProcess } from 'child_process';

// Runs the site's own block editor, so it needs a running WordPress site:
// STUDIO_BLOCK_EDITOR_URL=http://localhost:8881 npx vitest run block-validator
const siteUrl = process.env.STUDIO_BLOCK_EDITOR_URL;
// The same site's folder, for cases that add a plugin to it.
const sitePath = process.env.STUDIO_BLOCK_EDITOR_PATH;
// A WordPress install to render blocks on with WP-CLI's `wp`, as a copy.
const wordpress = process.env.STUDIO_TEST_WORDPRESS;

const group = ( attrs: string, inner: string ) =>
	`<!-- wp:group ${ attrs } -->\n${ inner }\n<!-- /wp:group -->`;
const paragraph = ( attrs: string, html: string ) =>
	`<!-- wp:paragraph ${ attrs } -->\n${ html }\n<!-- /wp:paragraph -->`;

describe( 'dropCommentsBetweenBlocks', () => {
	const hello = '<!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph -->';
	it.each( [
		{
			name: 'comments between blocks',
			markup: `<!-- ===== HERO ===== -->\n${ hello }\n\n<!-- one --><!-- two -->\n${ hello }`,
			expected: { content: `${ hello }\n\n${ hello }`, comments: 2 },
		},
		{
			name: 'a comment inside a block',
			markup: paragraph( '', '<p>Hello<!-- note --></p>' ),
			expected: { content: paragraph( '', '<p>Hello<!-- note --></p>' ), comments: 0 },
		},
		{
			name: 'a comment beside HTML outside any block',
			markup: `<!-- note --><div>Hi</div>\n${ hello }`,
			expected: { content: `<!-- note --><div>Hi</div>\n${ hello }`, comments: 0 },
		},
		{
			name: 'a comment beside an element with no text, outside any block',
			markup: `<!-- note --><hr>\n${ hello }`,
			expected: { content: `<!-- note --><hr>\n${ hello }`, comments: 0 },
		},
		{
			name: 'a comment beside text outside any block',
			markup: `<!-- note -->Hi\n${ hello }`,
			expected: { content: `<!-- note -->Hi\n${ hello }`, comments: 0 },
		},
		{
			name: 'a paragraph holding only a comment',
			markup: '<!-- wp:paragraph -->\n<p><!-- note --></p>\n<!-- /wp:paragraph -->',
			expected: {
				content: '<!-- wp:paragraph -->\n<p><!-- note --></p>\n<!-- /wp:paragraph -->',
				comments: 0,
			},
		},
		{
			name: 'a line break outside any block, beside a comment',
			markup: `<br>\n${ hello }\n<!-- note -->\n${ hello }`,
			expected: { content: `<br>\n${ hello }\n\n${ hello }`, comments: 1 },
		},
		{
			name: 'no comments',
			markup: hello,
			expected: { content: hello, comments: 0 },
		},
	] )( 'drops what renders nothing between blocks: $name', ( { markup, expected } ) => {
		expect( dropCommentsBetweenBlocks( markup ) ).toEqual( expected );
	} );
} );

describe.runIf( siteUrl )( 'validating in the block editor (live)', () => {
	afterAll( cleanupValidatorPages );

	it( 'names the blocks whose save makes each element, sorted', async () => {
		const saving = await blocksSavingElements(
			'<div class="faq"><details><summary>Hours?</summary><p>9 to 5.</p></details></div>',
			siteUrl!
		);
		expect( saving.map( ( { element } ) => element ) ).toEqual( [
			'div',
			'details',
			'summary',
			'p',
		] );
		const blocks = Object.fromEntries(
			saving.map( ( { element, blocks } ) => [ element, blocks ] )
		);
		expect( blocks.details ).toEqual( [ 'core/details' ] );
		expect( blocks.summary ).toEqual( [] );
		expect( blocks.p ).toContain( 'core/paragraph' );
		expect( blocks.div ).toEqual( expect.arrayContaining( [ 'core/columns', 'core/group' ] ) );
		expect( blocks.div ).toEqual( [ ...blocks.div ].sort() );
	}, 60_000 );

	it.each( [
		{
			name: 'a group written without its wrapper keeps its classes',
			markup: group(
				'{"className":"grid"}',
				group( '{"className":"cell"}', paragraph( '{}', '<p>Fast &mdash; always</p>' ) )
			),
			fixed: [ '<div class="wp-block-group grid"><!-- wp:group {"className":"cell"}' ],
		},
		{
			name: 'an image keeps the size its comment names',
			markup: group(
				'{}',
				'<!-- wp:image {"sizeSlug":"large"} -->\n<figure class="wp-block-image"><img src="https://example.com/a.png" alt=""/></figure>\n<!-- /wp:image -->'
			),
			fixed: [ '"sizeSlug":"large"', 'size-large' ],
		},
		{
			name: 'a block an older version accepts is saved as the current version',
			markup: paragraph(
				'{"className":"eyebrow","style":{"typography":{"fontWeight":"700"}},"textColor":"red","fontSize":"small"}',
				'<p class="eyebrow has-red-color has-small-font-size" style="font-weight:700">Eyebrow</p>'
			),
			fixed: [
				'<p class="eyebrow has-red-color has-text-color has-small-font-size" style="font-weight:700">Eyebrow</p>',
			],
		},
		{
			name: "a paragraph's textAlign moves to where WordPress 7.0 reads it",
			markup: paragraph( '{"textAlign":"center"}', '<p>Centered</p>' ),
			fixed: [ '{"style":{"typography":{"textAlign":"center"}}}', 'has-text-align-center' ],
		},
		{
			name: "an attribute at the block's default is kept",
			markup: group(
				'{}',
				'<!-- wp:site-title {"level":1} /-->\n<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->'
			),
			fixed: [ '<div class="wp-block-group"><!-- wp:site-title /-->' ],
		},
	] )(
		'$name',
		async ( { markup, fixed } ) => {
			const report = await validateBlocks( markup, siteUrl! );
			expect( report.error ).toBeUndefined();
			expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
			expect( report.proposedFix?.losses ).toEqual( [] );
			for ( const text of fixed ) {
				expect( report.proposedFix?.fixedContent ).toContain( text );
			}
		},
		60_000
	);

	const cover = ( html: string ) =>
		`<!-- wp:cover {"minHeight":"100dvh"} -->\n${ html }\n<!-- /wp:cover -->`;
	const coverIssue = 'core/cover\'s "minHeight" is of type number, so WordPress ignores "100dvh".';

	it.each( [
		{
			name: 'leaves it out of the fix',
			markup: cover(
				'<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>'
			),
			issue: coverIssue,
			losses: [],
		},
		{
			// As the editor stores it: a minHeight of 100 with the minHeightUnit
			// dvh, which its save holds min-height from (cover/save.js).
			name: 'stores the value it renders too as the attributes its save holds it from',
			markup: cover(
				'<div class="wp-block-cover" style="min-height:100dvh"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>'
			),
			issue: coverIssue,
			losses: [],
			stored: '"minHeight":100,"minHeightUnit":"dvh"',
		},
		{
			name: 'leaves a value the block markup does not hold out of the fix',
			markup:
				'<!-- wp:columns {"verticalAlignment":null} -->\n<div class="wp-block-columns alignwide"></div>\n<!-- /wp:columns -->',
			issue: 'core/columns\'s "verticalAlignment" is of type string, so WordPress ignores null.',
			losses: [],
		},
	] )(
		'reports an attribute of the wrong type, and $name',
		async ( { markup, issue, losses, stored } ) => {
			const report = await validateBlocks( markup, siteUrl! );
			expect( report.results[ 0 ].issues ).toContain( issue );
			expect( report.proposedFix?.losses ).toEqual( losses );
			expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
			expect( report.proposedFix?.fixedContent ).toContain( stored ?? '' );
		},
		60_000
	);

	it( 'makes a block written in an older version again from what that version migrates it to', async () => {
		// WordPress 7.1's paragraph reads its alignment from
		// style.typography.textAlign; its deprecated version with `align`
		// migrates it there, but saves no custom class, so the editor's own
		// fix would drop the eyebrow class (paragraph/deprecated.js).
		const written =
			'<!-- wp:paragraph {"align":"center","style":{"color":{"text":"#d4a56a"}},"className":"eyebrow"} -->\n<p class="has-text-align-center eyebrow" style="color:#d4a56a">Juniper &amp; Oak</p>\n<!-- /wp:paragraph -->';
		const report = await validateBlocks( written, siteUrl! );
		expect( report.invalidBlocks ).toBeGreaterThan( 0 );
		expect( report.proposedFix?.losses ).toEqual( [] );
		expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
		expect( report.proposedFix?.fixedContent ).toContain( '"textAlign":"center"' );
		expect( report.proposedFix?.fixedContent ).toContain( 'class="has-text-align-center eyebrow' );
	}, 60_000 );

	it.each( [
		{
			block: 'paragraph',
			written:
				'<!-- wp:paragraph {"style":{"typography":{"textAlign":"center"}}} -->\n<p>Visit us</p>\n<!-- /wp:paragraph -->',
			saved: '<p class="has-text-align-center">Visit us</p>',
		},
		{
			block: 'heading',
			written:
				'<!-- wp:heading {"style":{"typography":{"textAlign":"center"}}} -->\n<h2 class="wp-block-heading">Hours</h2>\n<!-- /wp:heading -->',
			saved: '<h2 class="wp-block-heading has-text-align-center">Hours</h2>',
		},
	] )(
		'saves a $block only an older version accepts as the current version does',
		async ( { written, saved } ) => {
			// The older version, from before typography.textAlign, saves no
			// has-text-align-center: the page renders the text left until the
			// editor saves it again.
			const report = await validateBlocks( written, siteUrl!, 'site' );
			expect( report.invalidBlocks ).toBe( 1 );
			expect( report.proposedFix?.losses ).toEqual( [] );
			expect( report.proposedFix?.fixedContent ).toContain( saved );
		},
		60_000
	);

	it.each( [
		{
			name: 'a spacing preset, as the editor stores a preset',
			written:
				'<!-- wp:columns -->\n<div class="wp-block-columns" style="margin-top:var(--wp--preset--spacing--50)"></div>\n<!-- /wp:columns -->',
			saved: '<!-- wp:columns {"style":{"spacing":{"margin":{"top":"var:preset|spacing|50"}}}} -->',
		},
		{
			name: 'a color, a radius and padding, as written',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="background-color:#efe6d8;border-top-left-radius:28px;padding-top:2.4rem"></div>\n<!-- /wp:group -->',
			saved:
				'<!-- wp:group {"style":{"color":{"background":"#efe6d8"},"border":{"radius":{"topLeft":"28px"}},"spacing":{"padding":{"top":"2.4rem"}}}} -->',
		},
		{
			name: 'a background shorthand, as the color it sets',
			written:
				'<!-- wp:column -->\n<div class="wp-block-column" style="background:#efe6d8"></div>\n<!-- /wp:column -->',
			saved: '<!-- wp:column {"style":{"color":{"background":"#efe6d8"}}} -->',
		},
		{
			name: 'on the element the block saves them on',
			written:
				'<!-- wp:button -->\n<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" style="padding-top:1rem">Book</a></div>\n<!-- /wp:button -->',
			saved:
				'<!-- wp:button {"style":{"spacing":{"padding":{"top":"1rem"}}}} -->\n<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" style="padding-top:1rem">Book</a></div>',
		},
		{
			name: 'only its own, beside an inner block with styles of its own',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="padding-top:1rem"><!-- wp:group -->\n<div class="wp-block-group" style="padding-top:2rem"></div>\n<!-- /wp:group --></div>\n<!-- /wp:group -->',
			saved:
				'<!-- wp:group {"style":{"spacing":{"padding":{"top":"1rem"}}}} -->\n<div class="wp-block-group" style="padding-top:1rem"><!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem"}}}} -->',
		},
		{
			name: 'a gradient, as the shorthand the style engine saves it as',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="background:linear-gradient(135deg,#2E4637 0%,#22302A 100%)"></div>\n<!-- /wp:group -->',
			saved:
				'<!-- wp:group {"style":{"color":{"gradient":"linear-gradient(135deg,#2E4637 0%,#22302A 100%)"}}} -->',
		},
		{
			// core/image saves scale as object-fit on its img, and the style
			// engine's dimensions.objectFit on its figure.
			name: 'in the attribute the block saves the style from',
			written:
				'<!-- wp:image {"id":9,"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="https://example.com/a.jpg" alt="" class="wp-image-9" style="object-fit:cover"/></figure>\n<!-- /wp:image -->',
			saved: '"scale":"cover"',
		},
		{
			name: 'in each attribute the block saves one of them from',
			written:
				'<!-- wp:image {"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="https://example.com/a.jpg" alt="" style="aspect-ratio:4/3;width:100%;height:auto"/></figure>\n<!-- /wp:image -->',
			saved: '{"width":"100%","height":"auto","aspectRatio":"4/3","sizeSlug":"large"}',
		},
		{
			// eval22 picky port 2: Chrome reads a var() shorthand's longhands as empty.
			name: 'a shorthand holding a preset',
			written:
				'<!-- wp:group {"style":{"border":{"width":"1px"}}} -->\n<div class="wp-block-group has-border-color" style="border-color:var(--wp--preset--color--accent-5);border-width:1px"></div>\n<!-- /wp:group -->',
			saved: '"border":{"width":"1px","color":"var:preset|color|accent-5"}',
		},
		{
			name: 'in a number attribute the block saves the style from',
			written:
				'<!-- wp:cover -->\n<div class="wp-block-cover" style="min-height:500px"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-100 has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>\n<!-- /wp:cover -->',
			saved: '<!-- wp:cover {"minHeight":500} -->',
		},
	] )(
		'stores the inline styles a block would drop where it saves them from: $name',
		async ( { written, saved } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.invalidBlocks ).toBeGreaterThan( 0 );
			expect( report.proposedFix?.losses ).toEqual( [] );
			expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
			expect( report.proposedFix?.fixedContent ).toContain( saved );
		},
		60_000
	);

	it.each( [
		{
			name: 'core/image',
			written:
				'<!-- wp:image {"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="https://example.com/a.jpg" alt="" class="wp-image-6"/></figure>\n<!-- /wp:image -->',
			saved: '<!-- wp:image {"id":6,"sizeSlug":"large"} -->',
		},
		{
			name: 'core/media-text',
			written:
				'<!-- wp:media-text {"mediaType":"image"} -->\n<div class="wp-block-media-text is-stacked-on-mobile"><figure class="wp-block-media-text__media"><img src="https://example.com/a.jpg" alt="" class="wp-image-7 size-full"/></figure><div class="wp-block-media-text__content"></div></div>\n<!-- /wp:media-text -->',
			saved: '"mediaId":7',
		},
		{
			name: 'core/paragraph, a palette text color',
			written:
				'<!-- wp:paragraph -->\n<p class="has-sage-dark-color has-text-color" style="margin-top:1rem">Hi</p>\n<!-- /wp:paragraph -->',
			saved: '"textColor":"sage-dark"',
		},
		{
			name: 'core/button, a palette border color its text color class also matches',
			written:
				'<!-- wp:button {"style":{"border":{"width":"1px"}}} -->\n<div class="wp-block-button"><a class="wp-block-button__link has-cream-border-color has-border-color wp-element-button" style="border-width:1px;padding-top:1rem">Go</a></div>\n<!-- /wp:button -->',
			saved: '"borderColor":"cream"',
		},
		{
			// eval22 redo port 1: an outline button's has-text-color with no color, stored as textColor "text".
			name: 'core/button, none from has-text-color, which it saves for every text color',
			written:
				'<!-- wp:button {"className":"is-style-outline"} -->\n<div class="wp-block-button is-style-outline"><a class="wp-block-button__link has-text-color wp-element-button" style="padding-top:1rem">Go</a></div>\n<!-- /wp:button -->',
			saved: undefined,
		},
	] )(
		'stores the value a class names where $name saves it from',
		async ( { written, saved } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.invalidBlocks ).toBeGreaterThan( 0 );
			if ( ! saved ) {
				expect( report.proposedFix?.fixedContent ?? '' ).not.toContain( '"textColor"' );
				return;
			}
			expect( report.proposedFix?.losses ).toEqual( [] );
			expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
			expect( report.proposedFix?.fixedContent ).toContain( saved );
		},
		60_000
	);

	it( "makes a block with the inner blocks its older version's migration makes", async () => {
		const written = ( style: string ) =>
			`<!-- wp:list -->\n<ul data-kind="steps"${ style }><li>One</li><li>Two</li></ul>\n<!-- /wp:list -->`;
		const fixed = await validateBlocks( written( '' ), siteUrl! );
		expect( fixed.proposedFix?.losses ).toEqual( [] );
		expect( fixed.proposedFix?.fixedContent ).toContain( '<!-- wp:list-item -->\n<li>Two</li>' );
		const lossy = await validateBlocks( written( ' style="columns:2"' ), siteUrl! );
		expect( lossy.proposedFix?.losses ).toHaveLength( 1 );
		expect( lossy.results[ 0 ].expectedContent ).toContain( '<!-- wp:list-item -->' );
	}, 60_000 );

	it( 'stores the values an element holds where the block saves them from: core/cover', async () => {
		const report = await validateBlocks(
			'<!-- wp:cover {"dimRatio":60,"isDark":true} -->\n<div class="wp-block-cover is-dark"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-60 has-background-dim"></span><img class="wp-block-cover__image-background" alt="A bright dental office" src="https://example.com/hero.jpg" data-object-fit="cover"/><div class="wp-block-cover__inner-container"></div></div>\n<!-- /wp:cover -->',
			siteUrl!
		);
		expect( report.invalidBlocks ).toBeGreaterThan( 0 );
		expect( report.proposedFix?.losses ).toEqual( [] );
		expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
		expect( report.proposedFix?.fixedContent ).toContain(
			'"url":"https://example.com/hero.jpg","alt":"A bright dental office"'
		);
	}, 60_000 );

	it.each( [
		{
			name: 'a class the block already saves',
			written:
				'<!-- wp:cover -->\n<div class="wp-block-cover" style="padding-top:1rem"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-100 has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>\n<!-- /wp:cover -->',
			saved: '<!-- wp:cover {"style":{"spacing":{"padding":{"top":"1rem"}}}} -->',
		},
		{
			name: 'an id the comment already sets',
			written:
				'<!-- wp:image {"id":5} -->\n<figure class="wp-block-image" style="margin-top:1rem"><img src="https://example.com/a.jpg" alt="" class="wp-image-5 wp-image-6"/></figure>\n<!-- /wp:image -->',
			saved: undefined,
		},
		{
			name: 'a class whose number is not one',
			written:
				'<!-- wp:image -->\n<figure class="wp-block-image" style="margin-top:1rem"><img src="https://example.com/a.jpg" alt="" class="wp-image-hero"/></figure>\n<!-- /wp:image -->',
			saved: undefined,
		},
	] )(
		'stores no id from $name',
		async ( { written, saved } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.proposedFix?.fixedContent ?? '' ).not.toMatch( /"id":(100|6|null)\b/ );
			if ( saved ) {
				expect( report.proposedFix?.fixedContent ).toContain( saved );
			}
		},
		60_000
	);

	// Layout and position styles render from attributes as a class, so the
	// fix's loss names the attributes; stored there, nothing is lost.
	it.each( [
		{
			name: 'a flex group',
			written:
				'<!-- wp:group {"layout":{"type":"flex"}} -->\n<div class="wp-block-group" style="justify-content:right;gap:2rem"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			lost: 'drop the styles justify-content:right; row-gap:2rem; column-gap:2rem — store them as "style":{"spacing":{"blockGap":"2rem"}},"layout":{"justifyContent":"right"}',
			stored:
				'<!-- wp:group {"layout":{"type":"flex","justifyContent":"right"},"style":{"spacing":{"blockGap":"2rem"}}} -->\n<div class="wp-block-group"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			note: 'drop justify-content:right; row-gap:2rem; column-gap:2rem from div.wp-block-group — store them as "style":{"spacing":{"blockGap":"2rem"}},"layout":{"justifyContent":"right"}',
			still: [],
		},
		{
			name: 'a group written as flex inline',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="display:flex;align-items:center;gap:1rem"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			lost: 'drop the styles display:flex; align-items:center; row-gap:1rem; column-gap:1rem — store them as "layout":{"type":"flex","verticalAlignment":"center"},"style":{"spacing":{"blockGap":"1rem"}}',
			stored:
				'<!-- wp:group {"layout":{"type":"flex","verticalAlignment":"center"},"style":{"spacing":{"blockGap":"1rem"}}} -->\n<div class="wp-block-group"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			note: 'drop display:flex; align-items:center; row-gap:1rem; column-gap:1rem from div.wp-block-group — store them as "layout":{"type":"flex","verticalAlignment":"center"},"style":{"spacing":{"blockGap":"1rem"}}',
			still: [],
		},
		{
			// Its z-index the position support renders as 10
			// (wp_render_position_support in wp-includes/block-supports/position.php).
			name: 'a sticky group, with a z-index',
			written:
				'<!-- wp:group {"style":{"position":{"type":"sticky"}}} -->\n<div class="wp-block-group" style="position:sticky;top:0px;z-index:100"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			lost: 'drop the styles top:0px — store it as "style":{"position":{"type":"sticky","top":"0px"}}',
			stored:
				'<!-- wp:group {"style":{"position":{"type":"sticky","top":"0px"}}} -->\n<div class="wp-block-group" style="z-index:100"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			note: 'drop top:0px from div.wp-block-group — store it as "style":{"position":{"type":"sticky","top":"0px"}}',
			still: [],
		},
	] )(
		'names the attributes a style it drops renders from: $name',
		async ( { written, lost, note, stored, still } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.proposedFix?.losses.map( ( loss ) => loss.lost ) ).toEqual( [ lost ] );
			expect( report.proposedFix?.losses.map( ( loss ) => loss.note ) ).toEqual( [ note ] );
			const after = await validateBlocks( stored, siteUrl! );
			expect( after.proposedFix?.losses.map( ( loss ) => loss.lost ) ?? [] ).toEqual( still );
		},
		60_000
	);

	// A block's supports give it their classes and styles a render after it
	// shows, so a read before then finds the fix without them, as run h2h6's
	// pizzeria footer then read as losing the border it keeps.
	it( 'reads the fix as rendered once its supports apply', async () => {
		const written = [
			'<!-- wp:group {"tagName":"footer","align":"full","className":"ember-footer","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"},"blockGap":"0.5rem"},"color":{"background":"var:preset|color|accent-6","text":"var:preset|color|accent-5"},"border":{"top":{"width":"4px","style":"solid","color":"var:preset|color|accent-1"}}},"layout":{"type":"constrained"}} -->',
			'<footer class="wp-block-group alignfull ember-footer" style="padding-top:var(--wp--preset--spacing--60);padding-bottom:var(--wp--preset--spacing--60);background-color:var(--wp--preset--color--accent-6);color:var(--wp--preset--color--accent-5);border-top:4px solid var(--wp--preset--color--accent-1)">',
			'<!-- wp:site-title {"level":1,"style":{"color":{"text":"var:preset|color|base"},"typography":{"fontSize":"var:preset|font-size|x-large"}}} /-->',
			'<!-- wp:paragraph {"style":{"color":{"text":"var:preset|color|accent-2"},"typography":{"letterSpacing":"1.4px","textTransform":"uppercase","fontSize":"var:preset|font-size|small","fontWeight":"700"}}} -->',
			'<p style="color:var(--wp--preset--color--accent-2);font-size:var(--wp--preset--font-size--small);font-weight:700;letter-spacing:1.4px;text-transform:uppercase">Wood-fired sourdough \u00b7 Tuesday to Sunday, 5&nbsp;pm to 10&nbsp;pm</p>',
			'<!-- /wp:paragraph -->',
			'<!-- wp:paragraph {"style":{"color":{"text":"var:preset|color|accent-4"},"typography":{"fontSize":"var:preset|font-size|small"}}} -->',
			'<p style="color:var(--wp--preset--color--accent-4);font-size:var(--wp--preset--font-size--small)">\u00a9 2026 Ember Street Pizza. Fired with care since 2011.</p>',
			'<!-- /wp:paragraph -->',
			'</footer>',
			'<!-- /wp:group -->',
		].join( '\n' );
		for ( let i = 0; i < 12; i++ ) {
			const report = await validateBlocks( written, siteUrl!, 'site' );
			expect( report.proposedFix?.losses ).toEqual( [] );
		}
	}, 120_000 );

	it.each< {
		name: string;
		written: string;
		losses: { place: string; lost: string; note: string }[];
	} >( [
		{
			name: 'a flex layout its layout attribute already shows',
			written:
				'<!-- wp:group {"layout":{"type":"flex","flexWrap":"wrap","justifyContent":"center"},"style":{"spacing":{"blockGap":"1.4rem"}}} -->\n<div class="wp-block-group" style="display:flex;flex-wrap:wrap;gap:1.4rem;align-items:center"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			losses: [],
		},
		{
			// As run h2h5's pet store wrote its buttons: the medium preset, and its size
			// inline, which Twenty Twenty-Five, the test site's theme, gives as 1rem.
			name: 'a style the preset its attribute names gives',
			written:
				'<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button {"fontSize":"medium"} -->\n<div class="wp-block-button has-custom-font-size" style="font-size:1rem"><a class="wp-block-button__link wp-element-button">Shop</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->',
			losses: [],
		},
		{
			name: 'a style other than the preset its attribute names',
			written:
				'<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button {"fontSize":"medium"} -->\n<div class="wp-block-button has-custom-font-size" style="font-size:3rem"><a class="wp-block-button__link wp-element-button">Shop</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->',
			losses: [
				{
					place: '/0/0',
					lost: 'drop the styles font-size:3rem',
					note: 'drop font-size:3rem from div.wp-block-button',
				},
			],
		},
		{
			name: 'a display its layout attribute shows otherwise',
			written:
				'<!-- wp:group {"layout":{"type":"flex","flexWrap":"nowrap"}} -->\n<div class="wp-block-group" style="display:inline-flex;flex-wrap:nowrap"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the styles display:inline-flex',
					note: 'drop display:inline-flex from div.wp-block-group',
				},
			],
		},
		{
			// In its row of buttons, which is flex, the width is the button's own.
			name: 'a width that sizes the block where it sits',
			written:
				'<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button -->\n<div class="wp-block-button" style="width:100%"><a class="wp-block-button__link wp-element-button">Book</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->',
			losses: [
				{
					place: '/0/0',
					lost: 'drop the styles width:100%',
					note: 'drop width:100% from div.wp-block-button',
				},
			],
		},
		{
			// Its save names the dim rounded to tens (dimRatioToClass in
			// cover/shared.js), and no stylesheet names the one written.
			name: 'a class its save names with another number',
			written:
				'<!-- wp:cover {"dimRatio":45,"overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim-45 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [],
		},
		{
			// Written beside the class its save names, which the fix keeps.
			name: 'a class its save names with another number, written beside that one',
			written:
				'<!-- wp:cover {"dimRatio":42,"overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim-40 has-background-dim has-background-dim-42 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [],
		},
		{
			// has-background-dim-80 shows the overlay at 0.8 (the cover's style.scss),
			// not the 0.4 of the has-background-dim-40 the fix keeps.
			name: 'a class its save names with another number that shows the block otherwise',
			written:
				'<!-- wp:cover {"dimRatio":42,"overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim-40 has-background-dim has-background-dim-80"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the classes has-background-dim-80',
					note: 'drop the class has-background-dim-80 from span.wp-block-cover__background',
				},
			],
		},
		{
			// No stylesheet names it either, but it names no number its comment sets.
			name: 'a class its save names with another number than its comment sets',
			written:
				'<!-- wp:cover {"dimRatio":78,"overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim-75 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the classes has-background-dim-75',
					note: 'drop the class has-background-dim-75 from span.wp-block-cover__background',
				},
			],
		},
		{
			// The unit its comment sets stands, as the editor makes the block from it.
			name: 'a style its attributes save with another unit than its comment sets',
			written:
				'<!-- wp:cover {"dimRatio":50,"minHeight":50,"minHeightUnit":"px","overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover" style="min-height:88vh"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the styles min-height:88vh',
					note: 'drop min-height:88vh from div.wp-block-cover',
				},
			],
		},
		{
			// The class shows a dim of 60, which the fix stores as the dimRatio
			// its save names has-background-dim-60 from.
			name: 'a class that shows the block otherwise',
			written:
				'<!-- wp:cover {"dimRatio":70,"overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim-60 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [],
		},
		{
			// Its save names no dim for 50, which has-background-dim shows.
			name: 'a class the stylesheets give what the fix shows',
			written:
				'<!-- wp:cover {"dimRatio":50,"overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim-50 studio-test-shade has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the classes studio-test-shade',
					note: 'drop the class studio-test-shade from span.wp-block-cover__background',
				},
			],
		},
		{
			// has-border-color gives the image a solid border (common.css).
			name: 'a class that shows the block a border its fix leaves out',
			written:
				'<!-- wp:image {"id":9} -->\n<figure class="wp-block-image"><img src="https://example.com/a.png" alt="" class="has-border-color wp-image-9"/></figure>\n<!-- /wp:image -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the classes has-border-color',
					note: 'drop the class has-border-color from img.wp-image-9',
				},
			],
		},
		{
			// The editor makes the block from its comment's textColor (eval13:
			// an edit to the comment was otherwise saved back to the class's).
			name: 'a preset class the comment names another preset for',
			written: paragraph(
				'{"style":{"typography":{"fontWeight":"600"}},"textColor":"tertiary"}',
				'<p class="has-secondary-color has-text-color" style="font-weight:600">20</p>'
			),
			losses: [
				{
					place: '/0',
					lost: 'drop the classes has-secondary-color',
					note: 'drop the class has-secondary-color from p.has-text-color',
				},
			],
		},
		{
			// Group has no textAlign support (eval28): its text centers itself.
			name: 'a style the text inside it already shows',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="text-align:center"><!-- wp:heading {"style":{"typography":{"textAlign":"center"}}} -->\n<h2 class="wp-block-heading has-text-align-center">A</h2>\n<!-- /wp:heading --></div>\n<!-- /wp:group -->',
			losses: [],
		},
		{
			// The size its link saves with the small preset is the text's.
			name: 'a style its attributes set otherwise on the text inside it',
			written:
				'<!-- wp:button {"fontSize":"small"} -->\n<div class="wp-block-button has-custom-font-size" style="font-size:0.9rem"><a class="wp-block-button__link wp-element-button">Book</a></div>\n<!-- /wp:button -->',
			losses: [],
		},
		{
			name: 'a style the text inside it shows otherwise',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="text-align:center"><!-- wp:heading -->\n<h2 class="wp-block-heading">A</h2>\n<!-- /wp:heading --></div>\n<!-- /wp:group -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the styles text-align:center',
					note: 'drop text-align:center from div.wp-block-group',
				},
			],
		},
		{
			name: 'a style the text inside it does not inherit',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="filter:blur(2px)"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the styles filter:blur(2px)',
					note: 'drop filter:blur(2px) from div.wp-block-group',
				},
			],
		},
		{
			// The editor's own styles for its blocks set it there.
			name: 'a style only the editor gives its blocks',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="position:relative"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			losses: [
				{
					place: '/0',
					lost: 'drop the styles position:relative',
					note: 'drop position:relative from div.wp-block-group',
				},
			],
		},
	] )(
		'reads what is written on a block that its fix already shows as kept: $name',
		async ( { written, losses } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.invalidBlocks ).toBeGreaterThan( 0 );
			expect( report.proposedFix?.losses ).toEqual(
				losses.map( ( loss ) => ( { ...loss, blockName: expect.any( String ) } ) )
			);
		},
		60_000
	);

	// A cover's save names its dim rounded to tens (dimRatioToClass in
	// cover/shared.js), so a dimRatio of 78 saves has-background-dim-80.
	it.each( [
		{
			name: 'a dimRatio its save rounds past the class written',
			written:
				'<!-- wp:cover {"url":"https://example.com/a.jpg","id":16,"dimRatio":78,"overlayColor":"base","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><img class="wp-block-cover__image-background wp-image-16" alt="" src="https://example.com/a.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-base-background-color has-background-dim-70 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			stored: [ '"dimRatio":70', 'has-background-dim-70 ', 'wp-image-16' ],
		},
		{
			name: 'a dimRatio of a cover inside a group',
			written: group(
				'',
				'<div class="wp-block-group"><!-- wp:cover {"dimRatio":30} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-20 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover --></div>'
			),
			stored: [ '"dimRatio":20', 'has-background-dim-20 ' ],
		},
	] )(
		'stores the number a class names that its save names with another: $name',
		async ( { written, stored } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.invalidBlocks ).toBeGreaterThan( 0 );
			expect( report.proposedFix?.losses ).toEqual( [] );
			for ( const part of stored ) {
				expect( report.proposedFix?.fixedContent ).toContain( part );
			}
			expect(
				( await validateBlocks( report.proposedFix!.fixedContent, siteUrl! ) ).invalidBlocks
			).toBe( 0 );
		},
		60_000
	);

	// Covers written in eval31 (pivot, port 1), as written: each names its
	// comment's own dimRatio in a class that no stylesheet names, as the
	// cover's style.scss names the tens only, so it shows has-background-dim's
	// 0.5, and saves the dim rounded to tens; the first sets its minHeight as
	// "88vh", which is no number, so the editor reads it as unset and its save
	// holds min-height from a minHeight of 88 with the minHeightUnit vh.
	it.each( [
		{
			name: 'a dimRatio of 78 written as has-background-dim-78',
			written:
				'<!-- wp:cover {"url":"http://localhost:20034/wp-content/uploads/2026/11/cantina-hero.jpg","id":32,"alt":"A candlelit upscale Mexican restaurant interior at night","dimRatio":78,"overlayColor":"base","isUserOverlayColor":true,"align":"full","layout":{"type":"constrained"}} -->\n<div class="wp-block-cover alignfull"><span aria-hidden="true" class="wp-block-cover__background has-base-background-color has-background-dim-78 has-background-dim"></span><img class="wp-block-cover__image-background wp-image-32" alt="A candlelit upscale Mexican restaurant interior at night" src="http://localhost:20034/wp-content/uploads/2026/11/cantina-hero.jpg"/><div class="wp-block-cover__inner-container"><!-- wp:group {"layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"20vh","bottom":"14vh"}}}} -->\n<div class="wp-block-group" style="padding-top:20vh;padding-bottom:14vh"><!-- wp:paragraph {"style":{"typography":{"fontSize":"0.85rem","textTransform":"uppercase","letterSpacing":"0.24em"}},"textColor":"brass"} -->\n<p class="has-brass-color has-text-color" style="font-size:0.85rem;text-transform:uppercase;letter-spacing:0.24em">Modern Mexican \u00b7 Open late</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:heading {"level":1,"textColor":"ink"} -->\n<h1 class="wp-block-heading has-ink-color has-text-color">Mexico, after dark.</h1>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph {"textColor":"muted","style":{"typography":{"fontSize":"1.2rem"}}} -->\n<p class="has-muted-color has-text-color" style="font-size:1.2rem">Candlelit rooms, slow-braised moles, and mezcal poured by hand. Loco Cantina is a restaurant you settle into and lose track of time in.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"brass","textColor":"base"} -->\n<div class="wp-block-button"><a class="wp-block-button__link has-base-color has-brass-background-color has-text-color has-background wp-element-button" href="/contact/">Reserve a Table</a></div>\n<!-- /wp:button -->\n\n<!-- wp:button {"backgroundColor":"transparent","textColor":"ink","className":"is-style-outline","borderColor":"smoke"} -->\n<div class="wp-block-button is-style-outline"><a class="wp-block-button__link has-ink-color has-text-color has-border-color has-smoke-border-color wp-element-button" href="/menu/">View the Menu</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons --></div>\n<!-- /wp:group --></div></div>\n<!-- /wp:cover -->',
			losses: [],
			stored: [ '"dimRatio":78', 'has-background-dim-80 has-background-dim"' ],
		},
		{
			name: 'a dimRatio of 55 and a minHeight of "88vh"',
			written:
				'<!-- wp:cover {"url":"http://localhost:20034/wp-content/uploads/2026/11/taco-loco-hero.jpg","id":6,"alt":"Street tacos on a food truck counter","dimRatio":55,"overlayColor":"ink","isUserOverlayColor":true,"minHeight":"88vh","align":"full","style":{"spacing":{"padding":{"top":"0","bottom":"0"}}},"layout":{"type":"constrained"}} -->\n<div class="wp-block-cover alignfull" style="min-height:88vh"><span aria-hidden="true" class="wp-block-cover__background has-ink-background-color has-background-dim-55 has-background-dim"></span><img class="wp-block-cover__image-background wp-image-6" alt="Street tacos on a food truck counter" src="http://localhost:20034/wp-content/uploads/2026/11/taco-loco-hero.jpg"/><div class="wp-block-cover__inner-container"><!-- wp:group {"layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"18vh","bottom":"14vh"}}}} -->\n<div class="wp-block-group" style="padding-top:18vh;padding-bottom:14vh"><!-- wp:heading {"level":1,"textColor":"sun","align":"wide"} -->\n<h1 class="wp-block-heading alignwide has-sun-color has-text-color">Tacos so good,<br>they\'ll drive you loco.</h1>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph {"align":"wide","textColor":"white","style":{"typography":{"fontSize":"1.3rem","lineHeight":"1.5"}}} -->\n<p class="has-text-align-wide has-white-color has-text-color" style="font-size:1.3rem;line-height:1.5">Hand-pressed corn tortillas, grilled-to-order fillings, and salsa that bites back \u2014 served from our truck wherever the crowd gathers.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:buttons {"layout":{"type":"flex","flexWrap":"wrap"},"style":{"spacing":{"margin":{"top":"var:preset|spacing|40"}}}} -->\n<div class="wp-block-buttons" style="margin-top:var(--wp--preset--spacing--40)"><!-- wp:button {"backgroundColor":"salsa","textColor":"white"} -->\n<div class="wp-block-button"><a class="wp-block-button__link has-white-color has-salsa-background-color has-text-color has-background wp-element-button" href="/menu/">See the Menu</a></div>\n<!-- /wp:button -->\n\n<!-- wp:button {"backgroundColor":"sun","textColor":"ink"} -->\n<div class="wp-block-button"><a class="wp-block-button__link has-ink-color has-sun-background-color has-text-color has-background wp-element-button" href="/find-us/">Find Us Today</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons --></div>\n<!-- /wp:group --></div></div>\n<!-- /wp:cover -->',
			// The paragraph's own, which the cover's fix leaves to it.
			losses: [
				{
					place: '/0/0/1',
					blockName: 'core/paragraph',
					lost: 'drop the classes has-text-align-wide',
					note: 'drop the class has-text-align-wide from p.has-white-color',
				},
			],
			stored: [
				'"dimRatio":55',
				'"minHeight":88,"minHeightUnit":"vh"',
				'min-height:88vh',
				'has-background-dim-60 has-background-dim"',
			],
		},
	] )(
		'stores a cover that names its own dimRatio in a class its save rounds: $name',
		async ( { written, losses, stored } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.invalidBlocks ).toBeGreaterThan( 0 );
			expect( report.proposedFix?.losses ).toEqual( losses );
			for ( const part of stored ) {
				expect( report.proposedFix?.fixedContent ).toContain( part );
			}
			const again = await validateBlocks( report.proposedFix!.fixedContent, siteUrl! );
			expect(
				again.results.filter( ( result ) => result.blockName === 'core/cover' && ! result.isValid )
			).toEqual( [] );
		},
		60_000
	);

	it( 'reads a list the editor migrates from bare items as losing nothing beside a block that loses something', async () => {
		const report = await validateBlocks(
			'<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity" style="opacity:0.4"/>\n<!-- /wp:separator -->\n\n<!-- wp:list {"className":"hours"} -->\n<ul class="wp-block-list hours"><li><span>Monday</span><strong>7 am</strong></li>\n<li>Sunday</li></ul>\n<!-- /wp:list -->',
			siteUrl!
		);
		expect( report.proposedFix?.losses ).toEqual( [
			{
				place: '/0',
				blockName: 'core/separator',
				lost: 'drop the styles opacity:0.4',
				note: 'drop opacity:0.4 from hr.wp-block-separator',
			},
		] );
		expect( report.proposedFix?.fixedContent ).toContain(
			'<!-- wp:list-item -->\n<li><span>Monday</span><strong>7 am</strong></li>'
		);
	}, 60_000 );

	it.each( [
		{
			name: 'a style no block attribute saves',
			written:
				'<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity" style="opacity:0.4"/>\n<!-- /wp:separator -->',
			lost: 'drop the styles opacity:0.4',
			note: 'drop opacity:0.4 from hr.wp-block-separator',
		},
		{
			name: 'a style no block attribute saves, beside one it does',
			written:
				'<!-- wp:paragraph -->\n<p style="font-size:1.1rem;opacity:0.92">Hi</p>\n<!-- /wp:paragraph -->',
			lost: 'drop the styles opacity:0.92',
			note: 'drop opacity:0.92 from p',
		},
		{
			// core/image saves its border on the img.
			name: 'a style the block saves on another element',
			written:
				'<!-- wp:image -->\n<figure class="wp-block-image" style="border-top-left-radius:12px"><img src="https://example.com/a.jpg" alt=""/></figure>\n<!-- /wp:image -->',
			lost: 'drop the styles border-top-left-radius:12px',
			note: 'drop border-top-left-radius:12px from figure.wp-block-image',
		},
	] )(
		'keeps the block as written for $name',
		async ( { written, lost, note } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.proposedFix?.losses ).toEqual( [
				{ place: '/0', blockName: expect.any( String ), lost, note },
			] );
		},
		60_000
	);

	// eval29's spoke-and-chain hero: an overlay written at an opacity its
	// save shows from has-background-dim-70 (dimRatioToClass, cover/shared.js).
	const overlay = ( dimRatio: number, opacity: number ) =>
		`<!-- wp:cover {"url":"https://example.com/hero.jpg","id":6,"dimRatio":${ dimRatio },"overlayColor":"base","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-base-background-color" style="opacity:${ opacity }"></span><img class="wp-block-cover__image-background wp-image-6" alt="" src="https://example.com/hero.jpg" data-object-fit="cover"/><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->`;
	it.each( [
		{ name: 'no one can see', written: overlay( 68, 0.68 ), losses: [] },
		{
			name: 'one can see',
			written: overlay( 70, 0.5 ),
			losses: [
				{
					place: '/0',
					blockName: 'core/cover',
					lost: 'drop the styles opacity:0.5',
					note: 'drop opacity:0.5 from span.wp-block-cover__background',
				},
			],
		},
	] )(
		'reads a style whose fix paints a difference $name',
		async ( { written, losses } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.proposedFix?.losses ).toEqual( losses );
			if ( losses.length ) {
				// The note names the element the style is dropped from, in place of
				// the editor's own log of the mismatch.
				const { problem } = await validateBlockMarkup( written, 'page', siteUrl! );
				expect( problem ).toContain(
					'  - core/cover: saving it as the block saves it would drop opacity:0.5 from span.wp-block-cover__background, as nothing in its comment attributes saves that.\n    written: '
				);
				expect( report.results[ 0 ].issues.length ).toBeGreaterThan( 0 );
				for ( const issue of report.results[ 0 ].issues ) {
					expect( problem ).not.toContain( issue );
				}
			}
			if ( ! losses.length ) {
				expect( report.proposedFix?.fixedContent ).toContain( 'has-background-dim-70' );
				expect(
					( await validateBlocks( report.proposedFix!.fixedContent, siteUrl! ) ).invalidBlocks
				).toBe( 0 );
			}
		},
		60_000
	);

	// eval29's pages: a lede whose width no attribute of the paragraph saves.
	const lede = ( width: string ) =>
		paragraph(
			'{"textColor":"muted","style":{"typography":{"fontSize":"1.35rem"}}}',
			`<p class="has-muted-color has-text-color" style="font-size:1.35rem;max-width:${ width }">Three voices</p>`
		);
	it.each( [
		{
			name: 'gives the blocks a block style of it',
			written: `${ lede( '640px' ) }\n\n${ lede( '640px' ) }`,
			blockStyles: true,
			styled: [ '/0', '/1' ],
		},
		{
			name: 'gives a block in a constrained group a block style of it',
			written: group(
				'{"layout":{"type":"constrained"}}',
				`<div class="wp-block-group">${ lede( '640px' ) }</div>`
			),
			blockStyles: true,
			styled: [ '/0/0' ],
		},
		{
			name: 'keeps the block as written without a theme to hold a block style',
			written: lede( '640px' ),
			blockStyles: false,
			styled: [],
		},
	] )(
		'for a style no attribute saves on the block, $name',
		async ( { written, blockStyles, styled } ) => {
			const report = await validateBlocks( written, siteUrl!, 'post', undefined, blockStyles );
			const fix = report.proposedFix!;
			if ( ! styled.length ) {
				expect( fix.losses ).toEqual( [
					{
						place: '/0',
						blockName: 'core/paragraph',
						lost: 'drop the styles max-width:640px',
						note: 'drop max-width:640px from p.has-muted-color',
					},
				] );
				expect( fix.blockStyles ).toBeUndefined();
				return;
			}
			expect( fix.losses ).toEqual( [] );
			expect( fix.blockStyles ).toEqual(
				styled.map( ( place ) => ( {
					place,
					blockName: 'core/paragraph',
					slug: 'max-width-640px',
					css: 'max-width:640px',
				} ) )
			);
			expect( fix.fixedContent ).toContain(
				'<!-- wp:paragraph {"className":"is-style-max-width-640px","style":{"typography":{"fontSize":"1.35rem"}},"textColor":"muted"} -->\n<p class="is-style-max-width-640px has-muted-color has-text-color" style="font-size:1.35rem">Three voices</p>'
			);
			expect( ( await validateBlocks( fix.fixedContent, siteUrl! ) ).invalidBlocks ).toBe( 0 );
		},
		60_000
	);

	it( 'reports HTML outside any block', async () => {
		const report = await validateBlocks(
			`<section class="hero"><h1>Hi</h1></section>\n${ paragraph( '{}', '<p>Ok</p>' ) }`,
			siteUrl!
		);
		expect( report.results ).toContainEqual(
			expect.objectContaining( { blockName: 'core/freeform', isValid: false } )
		);
		expect( report.validBlocks ).toBe( 1 );
	}, 60_000 );

	it( 'keeps a block as written when its fix would move an inner block to another element', async () => {
		const cover =
			'<!-- wp:cover {"url":"https://example.com/a.png","dimRatio":50} -->\n' +
			'<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span>' +
			'<!-- wp:image -->\n<figure class="wp-block-image"><img src="https://example.com/b.png" alt=""/></figure>\n<!-- /wp:image -->' +
			'<div class="wp-block-cover__inner-container">' +
			paragraph( '{}', '<p>Hello</p>' ) +
			'</div></div>\n<!-- /wp:cover -->';
		const report = await validateBlocks(
			`${ paragraph( '{"textAlign":"center"}', '<p>Centered</p>' ) }\n${ cover }`,
			siteUrl!
		);
		expect( report.proposedFix?.losses ).toEqual( [
			{
				place: '/1',
				blockName: 'core/cover',
				lost: 'move core/image into div.wp-block-cover__inner-container',
				note: 'move core/image into div.wp-block-cover__inner-container',
			},
		] );
		expect( report.proposedFix?.fixedContent ).toContain( 'has-text-align-center' );
		// The image stays before the inner container, where it was written.
		expect( report.proposedFix?.fixedContent ).toContain(
			'<!-- /wp:image -->\n<div class="wp-block-cover__inner-container">'
		);
	}, 60_000 );

	it( 'reads an element written without its classes as the one the fix saves around the inner blocks', async () => {
		const list =
			'<!-- wp:list {"style":{"spacing":{"padding":{"left":"1.25rem"}}}} -->\n<ul style="padding-left:1.25rem"><!-- wp:list-item -->\n<li>One</li>\n<!-- /wp:list-item --></ul>\n<!-- /wp:list -->';
		const report = await validateBlocks(
			`${ paragraph( '{"textAlign":"center"}', '<p>Centered</p>' ) }\n${ list }`,
			siteUrl!
		);
		expect( report.proposedFix?.losses ).toEqual( [] );
		expect( report.proposedFix?.fixedContent ).toContain(
			'<ul style="padding-left:1.25rem" class="wp-block-list"><!-- wp:list-item -->'
		);
	}, 60_000 );

	it( 'reads an inner block taken out of an element written without classes as moved', async () => {
		const report = await validateBlocks(
			'<!-- wp:cover {"dimRatio":100} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-100 has-background-dim"></span><div class="wp-block-cover__inner-container"><div><!-- wp:paragraph -->\n<p>Hello</p>\n<!-- /wp:paragraph --></div></div></div>\n<!-- /wp:cover -->',
			siteUrl!
		);
		expect( report.proposedFix?.losses ).toEqual( [
			{
				place: '/0',
				blockName: 'core/cover',
				lost: 'move core/paragraph out of div',
				note: 'move core/paragraph out of div',
			},
		] );
	}, 60_000 );

	it( 'reads entities as the text they show', async () => {
		const report = await validateBlocks(
			group( '{}', paragraph( '{}', '<p>A &mdash; B&nbsp;C</p>' ) ),
			siteUrl!
		);
		expect( report.proposedFix?.losses ).toEqual( [] );
	}, 60_000 );

	it.each( [
		{
			name: 'its classes',
			written:
				'<!-- wp:image -->\n<figure class="wp-block-image"><img class="photo" src="https://example.com/a.png" alt=""/></figure>\n<!-- /wp:image -->',
			blockName: 'core/image',
			lost: 'drop the classes photo',
			note: 'drop the class photo from img',
		},
		{
			name: 'its styles',
			written: paragraph( '{}', '<p style="position:sticky;top:0">Eyebrow</p>' ),
			blockName: 'core/paragraph',
			lost: 'drop the styles position:sticky; top:0px',
			note: 'drop position:sticky; top:0px from p',
		},
		{
			name: 'its text',
			written: paragraph( '{}', '<div>Lost words</div>' ),
			blockName: 'core/paragraph',
			lost: 'change the text',
			note: 'change its text',
		},
	] )(
		'names the block whose fix would lose $name, keeps it as written and saves the fix for the rest',
		async ( { written, blockName, lost, note } ) => {
			const markup = group(
				'{}',
				`${ paragraph( '{"textAlign":"center"}', '<p>Centered</p>' ) }\n${ written }`
			);
			const report = await validateBlocks( markup, siteUrl! );
			expect( report.proposedFix?.losses ).toEqual( [ { place: '/0/1', blockName, lost, note } ] );
			expect( report.proposedFix?.fixedContent ).toContain( 'has-text-align-center' );
			expect( report.proposedFix?.fixedContent ).toContain(
				`-->\n${ written.split( '\n' )[ 1 ] }\n<!--`
			);
		},
		60_000
	);
} );

describe.runIf( siteUrl )( 'storing palette colors as presets (live)', () => {
	afterAll( cleanupValidatorPages );
	const colors: Array< [ string, string ] > = [
		[ 'base', '#FFFFFF' ],
		[ 'accent-3', '#503AA8' ],
	];
	const palette = { colors, fontSizes: [], spacingSizes: [] };

	it( 'stores each color a palette color has as that preset, as the editor does', async () => {
		const markup = group(
			'{"style":{"color":{"background":"#503aa8","text":"#FFFFFF"},"elements":{"link":{"color":{"text":"#FFFFFF"}}}},"layout":{"type":"constrained"}}',
			'<div class="wp-block-group has-text-color has-background has-link-color" style="color:#FFFFFF;background-color:#503aa8">' +
				paragraph(
					'{"style":{"color":{"background":"#123456"}}}',
					'<p class="has-background" style="background-color:#123456">Custom stays</p>'
				) +
				'</div>'
		);
		const result = await storePresetValues( markup, siteUrl!, palette );

		expect( result.colors ).toEqual( [
			{ color: '#503aa8', slug: 'accent-3' },
			{ color: '#FFFFFF', slug: 'base' },
			{ color: '#FFFFFF', slug: 'base' },
		] );
		expect( result.content ).toContain(
			'<!-- wp:group {"style":{"elements":{"link":{"color":{"text":"var:preset|color|base"}}}},"backgroundColor":"accent-3","textColor":"base","layout":{"type":"constrained"}} -->'
		);
		expect( result.content ).toContain( 'has-base-color has-accent-3-background-color' );
		expect( result.content ).toContain( 'background-color:#123456' );
		expect( ( await validateBlocks( result.content, siteUrl! ) ).invalidBlocks ).toBe( 0 );
	}, 60_000 );

	it( 'stores a font size only on a block that has a font size, and leaves no empty style', async () => {
		const fontSizes: Array< [ string, string ] > = [ [ 'roast', '1.4rem' ] ];
		const only = paragraph(
			'{"style":{"typography":{"fontSize":"1.4rem"}}}',
			'<p style="font-size:1.4rem">Hi</p>'
		);
		expect(
			( await storePresetValues( only, siteUrl!, { colors: [], fontSizes, spacingSizes: [] } ) )
				.content
		).toBe( paragraph( '{"fontSize":"roast"}', '<p class="has-roast-font-size">Hi</p>' ) );
		const spacer =
			'<!-- wp:spacer {"style":{"typography":{"fontSize":"1.4rem"}}} -->\n<div style="height:100px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->';
		expect(
			await storePresetValues( spacer, siteUrl!, { colors: [], fontSizes, spacingSizes: [] } )
		).toEqual( {
			content: spacer,
			colors: [],
			fontSizes: [],
			spacingSizes: [],
		} );
	}, 60_000 );

	it( 'leaves no empty style behind', async () => {
		const markup = paragraph(
			'{"style":{"color":{"text":"#503AA8"}}}',
			'<p class="has-text-color" style="color:#503AA8">Hi</p>'
		);
		expect( ( await storePresetValues( markup, siteUrl!, palette ) ).content ).toBe(
			paragraph( '{"textColor":"accent-3"}', '<p class="has-accent-3-color has-text-color">Hi</p>' )
		);
	} );

	it( 'returns content without palette values as written', async () => {
		const markup = paragraph(
			'{"textColor":"base"}',
			'<p class="has-base-color has-text-color">Hi</p>'
		);
		expect( await storePresetValues( markup, siteUrl!, palette ) ).toEqual( {
			content: markup,
			colors: [],
			fontSizes: [],
			spacingSizes: [],
		} );
	} );

	it( 'stores each font size a preset has as that preset, as the editor does', async () => {
		const sized = ( size: string ) =>
			paragraph(
				`{"style":{"typography":{"fontSize":"${ size }","letterSpacing":"0.2em"}}}`,
				`<p style="font-size:${ size };letter-spacing:0.2em">Hi</p>`
			);
		const result = await storePresetValues( sized( '1.4rem' ) + sized( '1.5rem' ), siteUrl!, {
			colors: [],
			fontSizes: [ [ 'size-1-4-rem', '1.4rem' ] ],
			spacingSizes: [],
		} );
		expect( result.fontSizes ).toEqual( [ { size: '1.4rem', slug: 'size-1-4-rem' } ] );
		expect( result.content ).toBe(
			paragraph(
				'{"style":{"typography":{"letterSpacing":"0.2em"}},"fontSize":"size-1-4-rem"}',
				'<p class="has-size-1-4-rem-font-size" style="letter-spacing:0.2em">Hi</p>'
			) +
				'\n\n' +
				sized( '1.5rem' )
		);
		expect( ( await validateBlocks( result.content, siteUrl! ) ).invalidBlocks ).toBe( 0 );
	} );

	it( 'keeps a comment between blocks from becoming a Classic block when colors are stored', async () => {
		const markup = `<!-- ===== HERO ===== -->\n${ paragraph(
			'{"style":{"color":{"background":"#503AA8"}}}',
			'<p class="has-background" style="background-color:#503AA8">Hello</p>'
		) }`;
		const stored = async ( content: string ) =>
			( await storePresetValues( content, siteUrl!, palette ) ).content;
		expect( ( await validateBlocks( await stored( markup ), siteUrl! ) ).results ).toEqual(
			expect.arrayContaining( [ expect.objectContaining( { blockName: 'core/freeform' } ) ] )
		);
		const dropped = dropCommentsBetweenBlocks( markup ).content;
		expect( ( await validateBlocks( await stored( dropped ), siteUrl! ) ).invalidBlocks ).toBe( 0 );
	} );

	const nav = ( links: string ) => `<!-- wp:navigation -->\n${ links }\n<!-- /wp:navigation -->`;
	const postLink =
		'<!-- wp:navigation-link {"label":"About","type":"page","id":2,"kind":"post-type","metadata":{"bindings":{"url":{"source":"core/post-data","args":{"field":"link"}}}}} /-->';

	it.each( [
		{
			name: 'a page named by id with no url',
			markup: nav( '<!-- wp:navigation-link {"label":"About","type":"page","id":2} /-->' ),
			bound: [ 'About' ],
			has: postLink,
		},
		{
			name: 'a category named by id, in a submenu',
			markup: nav(
				'<!-- wp:navigation-submenu {"label":"More","type":"page","id":2,"kind":"post-type"} -->\n<!-- wp:navigation-link {"label":"News","type":"category","id":1} /-->\n<!-- /wp:navigation-submenu -->'
			),
			bound: [ 'News', 'More' ],
			has: '{"label":"News","type":"category","id":1,"kind":"taxonomy","metadata":{"bindings":{"url":{"source":"core/term-data","args":{"field":"link"}}}}}',
		},
		{
			name: 'a link with a url',
			markup: nav(
				'<!-- wp:navigation-link {"label":"About","type":"page","id":2,"url":"/about/"} /-->'
			),
			bound: [],
		},
		{
			name: 'a link already bound',
			markup: nav( postLink ),
			bound: [],
		},
		{
			name: 'a custom link',
			markup: nav( '<!-- wp:navigation-link {"label":"Shop","kind":"custom","id":7} /-->' ),
			bound: [],
		},
	] )( 'binds a navigation link to what it names: $name', async ( { markup, bound, has } ) => {
		const result = await bindNavigationLinks( markup, siteUrl! );
		expect( result.links ).toEqual( bound );
		if ( has ) {
			expect( result.content ).toContain( has );
		} else {
			expect( result.content ).toBe( markup );
		}
	} );

	// The site's editor tab, as the validator loaded it.
	const editorTab = async () =>
		( await getSharedBrowser() )
			.contexts()
			.flatMap( ( context ) => context.pages() )
			.find(
				( page ) =>
					page.url().startsWith( siteUrl! ) &&
					page.url().includes( 'post-new.php' ) &&
					! page.isClosed()
			)!;

	it( 'gives what the editor inserts for blocks whose default variation brings inner blocks', async () => {
		await insertedTemplates( [ 'core/paragraph' ], siteUrl! );
		// As a plugin registers them: each inserts the next, and the last a paragraph.
		await (
			await editorTab()
		).evaluate( () => {
			/* eslint-disable @typescript-eslint/no-explicit-any */
			const { blocks, blockEditor, element } = ( window as any ).wp;
			for ( const [ name, inner ] of [
				[ 'studio-test/form', 'studio-test/field' ],
				[ 'studio-test/field', 'core/paragraph' ],
				[ 'studio-test/a', 'core/paragraph' ],
				[ 'studio-test/b', 'core/paragraph' ],
				[ 'studio-test/c', 'core/paragraph' ],
			] ) {
				blocks.registerBlockType( name, {
					apiVersion: 3,
					title: name,
					category: 'widgets',
					attributes: { kind: { type: 'string' } },
					edit: () => null,
					save: () => element.createElement( blockEditor.InnerBlocks.Content ),
					variations: [
						{
							name: 'default',
							title: name,
							isDefault: true,
							scope: [ 'inserter' ],
							attributes: { kind: 'default' },
							innerBlocks: [ [ inner, inner === 'core/paragraph' ? { content: 'Hi' } : {} ] ],
						},
					],
				} );
			}
			/* eslint-enable @typescript-eslint/no-explicit-any */
		} );

		expect( await insertedTemplates( [ 'studio-test/field' ], siteUrl! ) ).toEqual( [
			{
				name: 'studio-test/field',
				markup:
					'<!-- wp:studio-test/field {"kind":"default"} -->\n<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->\n<!-- /wp:studio-test/field -->',
			},
		] );
		// A block another insert holds, and blocks that insert no inner blocks, are left out.
		expect(
			(
				await insertedTemplates(
					[ 'studio-test/field', 'core/paragraph', 'studio-test/form', 'core/group' ],
					siteUrl!
				)
			).map( ( template ) => template.name )
		).toEqual( [ 'studio-test/form' ] );
		expect(
			(
				await insertedTemplates(
					[ 'studio-test/a', 'studio-test/b', 'studio-test/c', 'studio-test/field' ],
					siteUrl!
				)
			).map( ( template ) => template.name )
		).toEqual( [ 'studio-test/a', 'studio-test/b', 'studio-test/c' ] );
	} );

	it( 'reports a block that is not registered, with the blocks its namespace registers', async () => {
		const report = await validateBlocks(
			'<!-- wp:core/paragraphs -->\n<p>A</p>\n<!-- /wp:core/paragraphs -->\n\n<!-- wp:nope/form /-->',
			siteUrl!
		);
		expect( report.invalidBlocks ).toBe( 2 );
		expect( report.results[ 0 ] ).toMatchObject( {
			blockName: 'core/paragraphs',
			isValid: false,
			originalContent: expect.stringContaining( '<p>A</p>' ),
		} );
		expect( report.results[ 0 ].issues[ 0 ] ).toMatch(
			/^core\/paragraphs is not registered on the site, so the editor shows it as an unsupported block\. The registered core\/ blocks are .*core\/paragraph,/
		);
		expect( report.results[ 1 ].issues[ 0 ] ).toBe(
			"nope/form is not registered on the site, so the editor shows it as an unsupported block. No nope/ blocks are registered in the site's block editor."
		);
	}, 60_000 );

	it( 'loads the editor again for a block registered since it loaded', async () => {
		// As a block of a plugin activated after the editor loaded.
		const forget = async ( name: string ) =>
			( await editorTab() ).evaluate(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				( block ) => ( window as any ).wp.blocks.unregisterBlockType( block ),
				name
			);
		await insertedTemplates( [ 'core/paragraph' ], siteUrl! );
		const loaded = await editorTab();
		// A block the editor knows, without a namespace as core's are written, keeps it.
		await validateBlocks( '<!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph -->', siteUrl! );
		expect( loaded.isClosed() ).toBe( false );

		await forget( 'core/verse' );
		await insertedTemplates( [ 'core/verse' ], siteUrl! );
		expect( loaded.isClosed() ).toBe( true );

		await forget( 'core/verse' );
		const report = await validateBlocks(
			'<!-- wp:verse -->\n<pre class="wp-block-verse">A</pre>\n<!-- /wp:verse -->',
			siteUrl!
		);
		expect( report.invalidBlocks ).toBe( 0 );
	}, 60_000 );
} );

describe.runIf( siteUrl && sitePath )( 'a block whose editor script throws (live)', () => {
	afterAll( cleanupValidatorPages );

	it( 'reports what the editor threw beside the block it did not register', async () => {
		// As a plugin writes a block.json editorScript that reads wp, with no
		// index.asset.php naming the scripts it depends on.
		const plugin = path.join( sitePath!, 'wp-content/mu-plugins/studio-test-thrower' );
		mkdirSync( plugin, { recursive: true } );
		writeFileSync(
			path.join( plugin, 'block.json' ),
			JSON.stringify( {
				apiVersion: 3,
				name: 'studio-test/thrower',
				title: 'Thrower',
				editorScript: 'file:./index.js',
			} )
		);
		writeFileSync(
			path.join( plugin, 'index.js' ),
			"wp.blocks.registerBlockType( 'studio-test/thrower', { edit: () => null, save: () => null } );\n"
		);
		writeFileSync(
			path.join( sitePath!, 'wp-content/mu-plugins/studio-test-thrower.php' ),
			"<?php\nadd_action( 'init', fn() => register_block_type( __DIR__ . '/studio-test-thrower/block.json' ) );\n"
		);
		try {
			const report = await validateBlocks( '<!-- wp:studio-test/thrower /-->', siteUrl! );
			expect( report.results[ 0 ].issues[ 0 ] ).toMatch(
				/^studio-test\/thrower is not registered on the site, so the editor shows it as an unsupported block\. No studio-test\/ blocks are registered in the site's block editor\. The site's block editor threw: wp is not defined \(http:\/\/\S+\/wp-content\/mu-plugins\/studio-test-thrower\/index\.js line 1\)\.$/
			);
		} finally {
			rmSync( plugin, { recursive: true, force: true } );
			rmSync( path.join( sitePath!, 'wp-content/mu-plugins/studio-test-thrower.php' ), {
				force: true,
			} );
		}
	}, 60_000 );
} );

describe.runIf( siteUrl && sitePath )( 'a block the site registers in PHP only (live)', () => {
	// eval22 redo port 2: a booking form registered with a render_callback alone.
	it( 'says the site renders it, and how the editor registers it', async () => {
		const plugin = path.join( sitePath!, 'wp-content/mu-plugins/studio-test-server-only.php' );
		writeFileSync(
			plugin,
			"<?php\nadd_action( 'init', fn() => register_block_type( 'studio-test/server-only', array( 'render_callback' => fn() => '<form></form>' ) ) );\n"
		);
		try {
			const report = await validateBlocks( '<!-- wp:studio-test/server-only /-->', siteUrl! );
			expect( report.results[ 0 ].issues[ 0 ] ).toMatch(
				/^studio-test\/server-only is registered on the site in PHP but not in the block editor.*'autoRegister' => true/
			);
		} finally {
			rmSync( plugin, { force: true } );
		}
	}, 60_000 );
} );

describe.runIf( siteUrl && sitePath )( 'a theme without sticky positions (live)', () => {
	afterAll( cleanupValidatorPages );

	it( 'names no attribute for a sticky style the theme renders nothing from', async () => {
		// WordPress renders style.position sticky only when the theme opts in
		// (wp_render_position_support in wp-includes/block-supports/position.php).
		const plugin = path.join( sitePath!, 'wp-content/mu-plugins/studio-test-no-sticky.php' );
		writeFileSync(
			plugin,
			`<?php
add_filter( 'wp_theme_json_data_theme', fn( $data ) => $data->update_with( array( 'version' => 3, 'settings' => array( 'position' => array( 'sticky' => false ) ) ) ) );
`
		);
		try {
			const result = await validateBlocks(
				'<!-- wp:group -->\n<div class="wp-block-group" style="position:sticky;top:0px"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
				siteUrl!
			);
			expect( result.proposedFix?.losses.map( ( { lost } ) => lost ) ).toEqual( [
				'drop the styles position:sticky; top:0px',
			] );
		} finally {
			rmSync( plugin, { force: true } );
		}
	}, 120_000 );
} );

describe.runIf( siteUrl && sitePath )( 'a block the Site Editor registers only (live)', () => {
	afterAll( cleanupValidatorPages );

	it( 'is valid in a template, validated in the Site Editor', async () => {
		// As WooCommerce unregisters its template blocks on post screens
		// (wc-block-library.js), by window.adminpage.
		const plugin = path.join( sitePath!, 'wp-content/mu-plugins/studio-test-template-only.php' );
		writeFileSync(
			plugin,
			`<?php
add_action( 'init', fn() => register_block_type( 'studio-test/template-only' ) );
add_action( 'enqueue_block_editor_assets', function () {
	wp_add_inline_script( 'wp-blocks', "wp.blocks.registerBlockType( 'studio-test/template-only', { title: 'T', save: () => null } ); if ( [ 'post-php', 'post-new-php' ].includes( window.adminpage ) ) { wp.blocks.unregisterBlockType( 'studio-test/template-only' ); }" );
} );
`
		);
		try {
			const markup = '<!-- wp:studio-test/template-only /-->';
			expect( ( await validateBlocks( markup, siteUrl!, 'post' ) ).invalidBlocks ).toBe( 1 );
			expect( await validateBlocks( markup, siteUrl!, 'site' ) ).toMatchObject( {
				totalBlocks: 1,
				invalidBlocks: 0,
			} );
		} finally {
			rmSync( plugin, { force: true } );
		}
	}, 120_000 );
} );

describe.runIf( siteUrl && sitePath )(
	'a plugin sending the first admin page elsewhere (live)',
	() => {
		afterAll( cleanupValidatorPages );

		it( 'loads the editor without waiting for the page it was sent to', async () => {
			// As WooCommerce sends the first admin page after its activation to its
			// setup wizard, here a page that sends its head and then takes 40s.
			const plugin = path.join( sitePath!, 'wp-content/mu-plugins/studio-test-redirect.php' );
			const once = `studio_test_redirected_${ Date.now() }`;
			writeFileSync(
				plugin,
				`<?php
add_action( 'admin_init', function () {
	if ( isset( $_GET['studio-test-slow'] ) ) {
		echo '<html><head><script src="http://192.0.2.1/never.js"></script></head></html>';
		exit;
	}
	if ( ! get_option( '${ once }' ) ) {
		update_option( '${ once }', 1 );
		wp_safe_redirect( admin_url( '?studio-test-slow=1' ) ); exit;
	}
} );
`
			);
			await cleanupValidatorPages();
			try {
				expect(
					await validateBlocks( '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->', siteUrl! )
				).toMatchObject( { totalBlocks: 1, invalidBlocks: 0 } );
			} finally {
				rmSync( plugin, { force: true } );
			}
		}, 120_000 );
	}
);

describe.runIf( siteUrl && wordpress )( 'a block WordPress renders on the server (live)', () => {
	let site: HostSite;
	const host = {
		sites: {
			wpCli: async ( { path: at }: HostSite, args: string[] ) => ( {
				exitCode: 0,
				...( await promisify( execFile )( 'wp', [ `--path=${ at }`, ...args ], {
					maxBuffer: 1e8,
				} ) ),
			} ),
		},
	} as unknown as StudioAgentHost;
	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'renders-alike-' ) );
		cpSync( wordpress!, root, { recursive: true } );
		site = { path: root, url: siteUrl!, name: 'Render' } as HostSite;
	} );
	afterAll( async () => {
		rmSync( site.path, { recursive: true, force: true } );
		await cleanupValidatorPages();
	} );
	const cover = ( attrs: string, before: string, classes: string ) =>
		`<!-- wp:cover ${ attrs } -->\n<div class="wp-block-cover">${ before }<span aria-hidden="true" class="wp-block-cover__background ${ classes }"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->`;
	const LATEST =
		'<!-- wp:latest-posts {"postsToShow":3} -->\n<ul class="wp-block-latest-posts__list wp-block-latest-posts"><li><a class="wp-block-latest-posts__post-title" href="http://localhost:8881/?p=1">Hello world!</a></li></ul>\n<!-- /wp:latest-posts -->';

	it.each( [
		{
			// render_block_core_latest_posts() renders the posts, not what is written.
			name: 'a list of posts written out',
			written: LATEST,
			render: true,
			lost: undefined,
		},
		{
			name: 'a list of posts written out, with nothing to render it',
			written: LATEST,
			render: false,
			lost: 'saving it as the block saves it would change its text and drop the class wp-block-latest-posts__post-title from a, as nothing in its comment attributes saves that.',
		},
		{
			// render_block_core_archives() renders the months the site has posts in.
			name: 'a dropdown of months written out',
			written:
				'<!-- wp:archives {"displayAsDropdown":true} -->\n<div class="wp-block-archives-dropdown wp-block-archives"><select name="archive-dropdown"><option value="">Select Month</option><option value="x">May 2026</option></select></div>\n<!-- /wp:archives -->',
			render: true,
			lost: undefined,
		},
		{
			// render_block_core_cover() renders what is written.
			name: 'a class the render shows',
			written: cover(
				'{"dimRatio":50,"overlayColor":"contrast","isUserOverlayColor":true}',
				'',
				'has-contrast-background-color has-background-dim-50 studio-test-shade has-background-dim'
			),
			render: true,
			lost: 'saving it as the block saves it would drop the class studio-test-shade from span.wp-block-cover__background, as nothing in its comment attributes saves that.',
		},
		{
			name: 'the options of a select the render shows',
			written: cover(
				'{"dimRatio":50,"overlayColor":"contrast","isUserOverlayColor":true}',
				'<select name="size"><option>Small</option><option>Large</option></select>',
				'has-contrast-background-color has-background-dim'
			),
			render: true,
			lost: 'saving it as the block saves it would change its text, as nothing in its comment attributes saves that.',
		},
	] )(
		'saves its fix when it renders as written: $name',
		async ( { written, render, lost } ) => {
			const result = await validateBlockMarkup(
				written,
				'page',
				siteUrl!,
				undefined,
				'post',
				render ? rendersAlikeOn( host, site ) : undefined
			);
			if ( lost ) {
				expect( result.problem ).toContain( lost );
				return;
			}
			expect( result.problem ).toBeUndefined();
			expect( result.summary ).toBe( 'page: 1/1 blocks valid' );
			expect( result.invalidBlocks ).toBe( 1 );
			expect( result.fixedContent ).toMatch( /^<!-- wp:[a-z-]+ \{.*\} \/-->$/ );
			expect( ( await validateBlocks( result.fixedContent!, siteUrl! ) ).invalidBlocks ).toBe( 0 );
		},
		120_000
	);
} );

describe.runIf( siteUrl )( 'text in the comment of a block the server renders (live)', () => {
	afterAll( cleanupValidatorPages );

	// An eval's private events page (Jetpack 16.4): form fields written with
	// a label and placeholder, attributes only an older version of each field
	// reads, around an empty <div>, the current version's save. The editor
	// reads them as the current version, without that text, and the server
	// renders each field with its default label from what it saves.
	const field = ( name: string, attrs: string ) =>
		`<!-- wp:jetpack/${ name } ${ attrs } -->\n<div></div>\n<!-- /wp:jetpack/${ name } -->`;
	const FORM = [
		'<!-- wp:jetpack/contact-form {"subject":"New private event enquiry"} -->',
		`<div class="wp-block-jetpack-contact-form">${ field(
			'field-name',
			'{"label":"Your name","required":true,"placeholder":"Full name"}'
		) }`,
		'',
		`${ field( 'field-date', '{"label":"Event date","required":true}' ) }</div>`,
		'<!-- /wp:jetpack/contact-form -->',
	].join( '\n' );
	const HOURS = paragraph(
		'{"style":{"color":{"text":"#aa3333"}}}',
		'<p style="color:#aa3333">Hours</p>'
	);
	const onSite = {
		sites: {
			wpCli: async ( { path: at }: HostSite, args: string[] ) => ( {
				exitCode: 0,
				...( await promisify( execFile )( 'wp', [ `--path=${ at }`, ...args ], {
					maxBuffer: 1e8,
				} ) ),
			} ),
		},
	} as unknown as StudioAgentHost;

	it.each( [
		{ name: 'the form alone', content: FORM, render: false },
		{
			// The page's other blocks are fixed; the fix is not parsed again to
			// store a palette color, which would drop the text again.
			name: 'the form beside a block the editor fixes',
			content: `${ HOURS }\n\n${ FORM }`,
			render: false,
		},
		// Each field renders on the site with the label it is written with.
		{ name: 'the form, rendered on the site', content: FORM, render: true },
	] )(
		'keeps the fields as written and names the text the editor drops: $name',
		async ( { content, render } ) => {
			if (
				( render && ! sitePath ) ||
				( await unregisteredInEditor( [ 'jetpack/field-name' ], siteUrl! ) ).length
			) {
				// Without Jetpack's blocks there is nothing to check, and without
				// the site's folder nothing to render them on.
				return;
			}
			const result = await validateBlockMarkup(
				content,
				'page',
				siteUrl!,
				{ colors: [ [ 'accent', '#aa3333' ] ], fontSizes: [], spacingSizes: [] },
				'post',
				render
					? rendersAlikeOn( onSite, { path: sitePath!, url: siteUrl!, name: 'Site' } as HostSite )
					: undefined
			);
			expect( result.summary ).toBe( 'page: 2 invalid block(s)' );
			expect( result.problem ).toContain(
				'  - jetpack/field-name: The editor reads it without "Your name" (label), "Full name" (placeholder) written in its comment, and WordPress renders it on the server from its attributes, so saving it drops that text from the page.\n    written: <div></div>\n    the block saves: <div><!-- wp:jetpack/label {"label":"Your name"} /--> <!-- wp:jetpack/input {"placeholder":"Full name"'
			);
			expect( result.problem ).toContain(
				'  - jetpack/field-date: The editor reads it without "Event date" (label) written in its comment'
			);
			if ( content === FORM ) {
				expect( result.fixedContent ).toBeUndefined();
				return;
			}
			expect( result.fixedContent ).toContain( '<p class="has-text-color" style="color:#aa3333">' );
			expect( result.fixedContent ).toContain( FORM );
			expect( result.paletteColors ).toBeUndefined();
		},
		120_000
	);
} );

describe.runIf( siteUrl )( 'text written between the inner blocks of a container (live)', () => {
	afterAll( cleanupValidatorPages );

	// An eval's booking page: a Jetpack form shortcode loose in a group, beside
	// a heading with a style its comment does not name.
	const written = ( text: string ) =>
		[
			'<!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem"}}},"backgroundColor":"surface","layout":{"type":"constrained"}} -->',
			'<div class="wp-block-group has-surface-background-color has-background" style="padding-top:2rem">',
			'<!-- wp:heading {"level":2} -->',
			'<h2 class="wp-block-heading" style="margin-bottom:1.25rem">Your request</h2>',
			'<!-- /wp:heading -->',
			'',
			`${ text }</div>`,
			'<!-- /wp:group -->',
		].join( '\n' );
	const FORM =
		'[contact-form subject="Booking"][contact-field label="Name" type="name" required="1"/][/contact-form]';

	// An eval's header part: links written straight into groups beside their
	// inner blocks.
	const HEADER = [
		'<!-- wp:group {"tagName":"header","className":"site-header","layout":{"type":"constrained","contentSize":"1180px"}} -->',
		'<header class="wp-block-group site-header"><!-- wp:group {"className":"header-inner","layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"space-between"},"style":{"spacing":{"blockGap":"2rem"}}} -->',
		'<div class="wp-block-group header-inner"><!-- wp:group {"layout":{"type":"flex","flexWrap":"nowrap"}} -->',
		'<div class="wp-block-group"><a class="header-mark" href="/" aria-label="Sudsy Paws home">🐾</a>',
		'',
		'<!-- wp:site-title {"level":0} /--></div>',
		'<!-- /wp:group -->',
		'',
		'<!-- wp:group {"className":"nav-links","layout":{"type":"flex","flexWrap":"nowrap"},"style":{"spacing":{"blockGap":"1.5rem"}}} -->',
		'<div class="wp-block-group nav-links"><a href="/">Home</a><a href="/services/">Services</a><a href="/about/">About</a><a href="/contact/">Contact</a>',
		'',
		'<!-- wp:buttons -->',
		'<div class="wp-block-buttons"><!-- wp:button {"className":"is-style-fill"} -->',
		'<div class="wp-block-button is-style-fill"><a class="wp-block-button__link wp-element-button" href="/contact/">Book Now</a></div>',
		'<!-- /wp:button --></div>',
		'<!-- /wp:buttons --></div>',
		'<!-- /wp:group --></div>',
		'<!-- /wp:group --></header>',
		'<!-- /wp:group -->',
		'',
	].join( '\n' );

	it.each( [
		{ file: 'tmp/page-book.html', content: written( FORM ), text: FORM },
		{ file: 'wp-content/themes/t/templates/page-book.html', content: written( FORM ), text: FORM },
		{
			file: 'tmp/page-book.html',
			content: written( 'Call <b>today</b>.' ),
			text: 'Call <b>today</b>.',
		},
		{
			file: 'wp-content/themes/t/parts/header.html',
			content: HEADER,
			text: '<a href="/">Home</a><a href="/services/">Services</a><a href="/about/">About</a><a href="/contact/">Contact</a>',
		},
	] )(
		'keeps the container as written in $file and reports it, saving no core/html block the policy fails',
		async ( { file, content, text } ) => {
			const dir = mkdtempSync( path.join( os.tmpdir(), 'studio-lift-' ) );
			try {
				const filePath = path.join( dir, file );
				mkdirSync( path.dirname( filePath ), { recursive: true } );
				writeFileSync( filePath, content );
				const result = await validateBlockMarkupFile( filePath, siteUrl! );
				const saved = result.fixedContent ?? content;
				expect( validateHtmlBlockPolicy( saved ).invalidHtmlBlocks ).toEqual( [] );
				expect( saved ).toContain( text );
				expect( result.problem ).toContain(
					'core/group: saving it as the block saves it would change its text'
				);
			} finally {
				rmSync( dir, { recursive: true, force: true } );
			}
		},
		120_000
	);
} );

describe.runIf( siteUrl )(
	'a comment between blocks beside a block the editor fixes (live)',
	() => {
		afterAll( cleanupValidatorPages );

		it( 'saves the fix without the comment', async () => {
			const result = await validateBlockMarkup(
				[
					paragraph(
						'{"style":{"color":{"text":"#aa3333"}}}',
						'<p style="color:#aa3333">Hours</p>'
					),
					'<!-- ===== STATS ===== -->',
					paragraph( '', '<p>Open daily</p>' ),
				].join( '\n\n' ),
				'page',
				siteUrl!
			);
			expect( result ).toMatchObject( { invalidBlocks: 1, droppedComments: 1 } );
			expect( result.problem ).toBeUndefined();
			expect( result.fixedContent ).toContain( '<p class="has-text-color" style="color:#aa3333">' );
			expect( result.fixedContent ).not.toContain( 'STATS' );
		}, 60000 );
	}
);

describe.runIf( siteUrl )( "the fix for the blocks inside one it can't fix (live)", () => {
	afterAll( cleanupValidatorPages );

	it.each( [
		{
			// An eval's hero: a cover whose dim class names 80 for a dimRatio of
			// 85, which its save rounds to 90, around blocks with the alignment
			// their deprecations migrate. Its min-height the fix stores as a
			// minHeight of 88 with the minHeightUnit vh, which its save holds it
			// from (cover/save.js).
			name: 'blocks inside a cover it stores the min-height of',
			written: [
				'<!-- wp:cover {"url":"http://x/a.jpg","id":16,"dimRatio":85,"overlayColor":"base","align":"full","style":{"dimensions":{"minHeight":"88vh"}}} -->',
				'<div class="wp-block-cover alignfull" style="min-height:88vh"><img class="wp-block-cover__image-background wp-image-16" alt="" src="http://x/a.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-base-background-color has-background-dim-80 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph {"align":"center","textColor":"accent-3"} -->',
				'<p class="has-text-align-center has-accent-3-color has-text-color">Kicker</p>',
				'<!-- /wp:paragraph -->',
				'<!-- wp:heading {"textAlign":"center","level":1} -->',
				'<h1 class="wp-block-heading has-text-align-center">Title</h1>',
				'<!-- /wp:heading --></div></div>',
				'<!-- /wp:cover -->',
			].join( '\n' ),
			lossy: [],
		},
		{
			// An eval's hero: a cover whose dim class names 80 for a dimRatio of
			// 85, which its save rounds to 90, around blocks with the alignment
			// their deprecations migrate. Its filter no attribute saves.
			name: 'blocks inside a cover kept as written',
			written: [
				'<!-- wp:cover {"url":"http://x/a.jpg","id":16,"dimRatio":85,"overlayColor":"base","align":"full","style":{"dimensions":{"minHeight":"88vh"}}} -->',
				'<div class="wp-block-cover alignfull" style="min-height:88vh;filter:blur(2px)"><img class="wp-block-cover__image-background wp-image-16" alt="" src="http://x/a.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-base-background-color has-background-dim-80 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph {"align":"center","textColor":"accent-3"} -->',
				'<p class="has-text-align-center has-accent-3-color has-text-color">Kicker</p>',
				'<!-- /wp:paragraph -->',
				'<!-- wp:heading {"textAlign":"center","level":1} -->',
				'<h1 class="wp-block-heading has-text-align-center">Title</h1>',
				'<!-- /wp:heading --></div></div>',
				'<!-- /wp:cover -->',
			].join( '\n' ),
			lossy: [ '/0' ],
		},
		{
			// An eval's separator: the color its has-accent-3-color class gives,
			// which its save does not write inline, written inline too.
			name: 'a style a preset class it saves gives',
			written: [
				'<!-- wp:separator {"backgroundColor":"accent-3"} -->',
				'<hr class="wp-block-separator has-text-color has-accent-3-color has-alpha-channel-opacity has-accent-3-background-color has-background" style="background-color:var(--wp--preset--color--accent-3);color:var(--wp--preset--color--accent-3)"/>',
				'<!-- /wp:separator -->',
			].join( '\n' ),
			lossy: [],
		},
		{
			// The same on a cover's overlay, an inner element, from its overlayColor.
			name: 'a style on an inner element a preset class it saves gives',
			written: [
				'<!-- wp:cover {"url":"http://x/a.jpg","id":16,"dimRatio":90,"overlayColor":"base"} -->',
				'<div class="wp-block-cover"><img class="wp-block-cover__image-background wp-image-16" alt="" src="http://x/a.jpg" data-object-fit="cover"/><span aria-hidden="true" class="wp-block-cover__background has-base-background-color has-background-dim-90 has-background-dim" style="background-color:var(--wp--preset--color--base)"></span><div class="wp-block-cover__inner-container"></div></div>',
				'<!-- /wp:cover -->',
			].join( '\n' ),
			lossy: [],
		},
	] )(
		'saves the fix for $name',
		async ( { written, lossy } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.invalidBlocks ).toBeGreaterThan( lossy.length );
			expect( report.proposedFix?.losses.map( ( loss ) => loss.place ) ).toEqual( lossy );
			const stored = await validateBlocks( report.proposedFix!.fixedContent, siteUrl! );
			expect(
				stored.results.filter( ( result ) => ! result.isValid ).map( ( result ) => result.place )
			).toEqual( lossy );
		},
		60_000
	);
} );

describe.runIf( siteUrl )( "eval31's ports: what the written HTML shows (live)", () => {
	afterAll( cleanupValidatorPages );

	// onepage-port-1's footer: a site title with its font family's preset
	// written in style, which core/site-title's deprecation migrates to a
	// fontFamily of heading (utils/migrate-font-family.js), the same font.
	const SITE_TITLE = [
		'<!-- wp:group {"layout":{"type":"constrained","contentSize":"420px"}} -->',
		'<div class="wp-block-group"><!-- wp:site-title {"level":0,"style":{"typography":{"fontFamily":"var:preset|font-family|heading","fontSize":"2rem","fontWeight":"600"}}} /-->',
		'<!-- wp:paragraph {"style":{"color":{"text":"#cdbfa7"},"typography":{"fontSize":"0.95rem"}}} -->',
		`<p style="color:#cdbfa7;font-size:0.95rem;">Wedding photography bathed in the light you'll remember. Golden Hour Studio, chasing the last light of the day across every celebration.</p>`,
		'<!-- /wp:paragraph --></div>',
		'<!-- /wp:group -->',
	].join( '\n' );
	// onepage-port-1's header: a sticky group, its z-index written inline.
	const HEADER = [
		'<!-- wp:group {"align":"full","style":{"color":{"background":"#faf7f0"},"position":{"type":"sticky","top":"0px"},"spacing":{"padding":{"top":"14px","bottom":"14px","left":"0px","right":"0px"},"margin":{"top":"0px","bottom":"0px"}},"border":{"bottom":{"color":"#efe5d2","width":"1px","style":"solid"}}},"layout":{"type":"constrained"}} -->',
		'<div class="wp-block-group alignfull" style="background-color:#faf7f0;border-bottom:1px solid #efe5d2;margin-top:0;margin-bottom:0;padding-top:14px;padding-bottom:14px;position:sticky;top:0px;z-index:99;">',
		'<!-- wp:group {"layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"space-between","verticalAlignment":"center"}} -->',
		'<div class="wp-block-group"><!-- wp:site-title {"level":0,"style":{"typography":{"fontFamily":"var:preset|font-family|heading","fontSize":"1.8rem","fontWeight":"600","letterSpacing":"0.01em"}}} /-->',
		'',
		'<!-- wp:group {"layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"center","justifyContent":"space-between"}} -->',
		'<div class="wp-block-group"><!-- wp:navigation {"overlayMenu":"mobile","layout":{"type":"flex","justifyContent":"center","orientation":"horizontal","flexWrap":"wrap"},"style":{"spacing":{"blockGap":"2.1rem"}}} -->',
		'<!-- wp:navigation-link {"label":"Portfolio","type":"custom","url":"#portfolio","kind":"custom"} /-->',
		'<!-- wp:navigation-link {"label":"Contact","type":"custom","url":"#contact","kind":"custom"} /-->',
		'<!-- /wp:navigation -->',
		'',
		'<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->',
		'<div class="wp-block-buttons"><!-- wp:button {"style":{"spacing":{"padding":{"top":"0.7em","right":"1.5em","bottom":"0.7em","left":"1.5em"}}}} -->',
		'<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="#contact">Book a Session</a></div>',
		'<!-- /wp:button --></div>',
		'<!-- /wp:buttons --></div>',
		'<!-- /wp:group --></div>',
		'<!-- /wp:group -->',
		'</div>',
		'<!-- /wp:group -->',
	].join( '\n' );
	// onepage-port-1's quote mark, whose class a sed changed and its comment
	// not. The test site has no gold or gold-dark, so its accent-3 and
	// accent-4 stand for them.
	const QUOTE = ( textColor: string, shown: string ) =>
		paragraph(
			`{"style":{"typography":{"fontFamily":"var:preset|font-family|heading"}},"textColor":"${ textColor }","fontSize":"size-2-rem"}`,
			`<p class="has-${ shown }-color has-text-color has-size-2-rem-font-size" style="font-family:var(--wp--preset--font-family--heading)">"</p>`
		);

	it.each( [
		{
			name: 'a site title with its font family preset in style',
			written: SITE_TITLE,
			fixed: [
				'<!-- wp:site-title {"level":0,"style":{"typography":{"fontSize":"2rem","fontWeight":"600"}},"fontFamily":"heading"} /-->',
			],
			lost: [] as string[],
		},
		{
			// wp_render_position_support (wp-includes/block-supports/position.php)
			// renders the sticky position at a z-index of 10.
			name: 'a sticky header with a z-index',
			written: HEADER,
			fixed: [
				'"position":{"type":"sticky","top":"0px"}',
				'"fontFamily":"heading"',
				'<div class="wp-block-group alignfull has-background" style="border-bottom-color:#efe5d2;border-bottom-style:solid;border-bottom-width:1px;background-color:#faf7f0;margin-top:0px;margin-bottom:0px;padding-top:14px;padding-right:0px;padding-bottom:14px;padding-left:0px">',
			],
			lost: [],
		},
		{
			name: 'a z-index on a group nothing positions',
			written: HEADER.replace( ',"position":{"type":"sticky","top":"0px"}', '' ).replace(
				'position:sticky;top:0px;',
				''
			),
			fixed: [],
			lost: [ 'drop the styles z-index:99' ],
		},
		{
			name: 'a color class of a preset the site has, beside another in the comment',
			written: QUOTE( 'accent-3', 'accent-4' ),
			fixed: [ '"textColor":"accent-4"', '<p class="has-accent-4-color has-text-color' ],
			lost: [],
		},
		{
			// As written in the eval, on a site without that preset: the class
			// shows nothing the comment's color would not.
			name: 'a color class of a preset the site lacks',
			written: QUOTE( 'gold', 'gold-dark' ),
			fixed: [ '"textColor":"gold"', '<p class="has-gold-dark-color has-text-color' ],
			lost: [ 'drop the classes has-gold-dark-color' ],
		},
	] )(
		'keeps what the written HTML shows: $name',
		async ( { written, fixed, lost } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.proposedFix?.losses.map( ( loss ) => loss.lost ) ).toEqual( lost );
			for ( const part of fixed ) {
				expect( report.proposedFix?.fixedContent ).toContain( part );
			}
			if ( ! lost.length ) {
				expect(
					( await validateBlocks( report.proposedFix!.fixedContent, siteUrl! ) ).invalidBlocks
				).toBe( 0 );
			}
		},
		120_000
	);
} );

// eval31 pileon port 4: parts/footer.html's sudsy/newsletter, registered in
// PHP with a render_callback only, stayed open after functions.php gave it
// "autoRegister", as the part itself was unchanged.
describe.runIf( wordpress )(
	"a theme's block the theme then registers in the editor (live)",
	() => {
		let site: HostSite;
		let server: ChildProcess;
		const run = promisify( execFile );
		const host = {
			sites: {
				resolve: async () => site,
				wpCli: async ( { path: at }: HostSite, args: string[] ) => ( {
					exitCode: 0,
					...( await run( 'wp', [ `--path=${ at }`, ...args ], { maxBuffer: 1e8 } ) ),
				} ),
			},
		} as unknown as StudioAgentHost;
		const theme = () => path.join( site.path, 'wp-content/themes/twentytwentyfive' );
		const register = ( args: string ) =>
			`\nadd_action( 'init', fn() => register_block_type( 'studio-test/newsletter', array( 'render_callback' => fn() => '<form class="studio-test-newsletter"></form>'${ args } ) ) );\n`;

		beforeAll( async () => {
			const root = mkdtempSync( path.join( os.tmpdir(), 'block-code-' ) );
			cpSync( wordpress!, root, { recursive: true } );
			const port = await new Promise< number >( ( resolve ) => {
				const probe = net.createServer().listen( 0, '127.0.0.1', () => {
					const { port: free } = probe.address() as net.AddressInfo;
					probe.close( () => resolve( free ) );
				} );
			} );
			site = { path: root, url: `http://127.0.0.1:${ port }`, name: 'Sudsy' } as HostSite;
			for ( const option of [ 'home', 'siteurl' ] ) {
				await run( 'wp', [ `--path=${ root }`, 'option', 'update', option, site.url ] );
			}
			await run( 'wp', [ `--path=${ root }`, 'theme', 'activate', 'twentytwentyfive' ] );
			// As Studio logs its browser in (EditorPage).
			mkdirSync( path.join( root, 'wp-content/mu-plugins' ), { recursive: true } );
			writeFileSync(
				path.join( root, 'wp-content/mu-plugins/studio-test-auto-login.php' ),
				`<?php
add_action( 'init', function () {
	if ( '/studio-auto-login' === parse_url( $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH ) ) {
		wp_set_auth_cookie( 1 );
		wp_redirect( home_url( $_GET['redirect_to'] ?? '/wp-admin/' ) );
		exit;
	}
} );
`
			);
			// Without opcache, which serves a file changed within opcache.revalidate_freq as it was.
			server = spawn(
				'php',
				[ '-d', 'opcache.enable=0', '-S', `127.0.0.1:${ port }`, '-t', root ],
				{
					cwd: root,
					stdio: 'ignore',
				}
			);
			for ( let tries = 0; tries < 50; tries++ ) {
				if (
					await fetch( site.url ).then(
						() => true,
						() => false
					)
				) {
					break;
				}
				await new Promise( ( resolve ) => setTimeout( resolve, 100 ) );
			}
		}, 120_000 );
		afterAll( async () => {
			await cleanupValidatorPages();
			server?.kill();
			rmSync( site.path, { recursive: true, force: true } );
		} );

		it( 'validates the part again once functions.php gives the block autoRegister, and clears its problem', async () => {
			const functions = path.join( theme(), 'functions.php' );
			appendFileSync( functions, register( '' ) );
			const part = path.join( theme(), 'parts/studio-test-newsletter.html' );
			writeFileSync( part, '<!-- wp:studio-test/newsletter /-->\n' );
			const open = new OpenProblems( [] );
			const gate = createBlockValidationGate( host, open );
			// The checks of the calls, which read the code the site registers its blocks from.
			const changes = new SiteChanges( host, open, async () => [ site ], [ blockEditorScripts ] );
			await changes.snapshot();
			gate.track( part, site.path );
			const first = await gate.settle();
			expect( first.problems ).toHaveLength( 1 );
			expect( first.problems[ 0 ] ).toMatch(
				/^parts\/studio-test-newsletter\.html: 1 invalid block\(s\)[\s\S]*studio-test\/newsletter is registered on the site in PHP but not in the block editor[\s\S]*'autoRegister' => true/
			);
			expect( await open.raise() ).toEqual( first.problems );

			// The part stays as it was; only functions.php changes, in a call of its own.
			await changes.begin();
			const php = readFileSync( functions, 'utf8' );
			writeFileSync(
				functions,
				php.replace( register( '' ), register( ", 'supports' => array( 'autoRegister' => true )" ) )
			);
			expect( ( await changes.settle() ).problems ).toEqual( [] );
			const started = Date.now();
			const second = await gate.settle();
			console.warn( `revalidated after the block code changed in ${ Date.now() - started }ms` );
			expect( second ).toEqual( {
				summaries: [ 'parts/studio-test-newsletter.html: 1/1 blocks valid' ],
				problems: [],
				saved: [],
			} );
			expect( await open.raise() ).toEqual( [] );
			expect( open.remind() ).toEqual( [] );
			// Nothing changed since: the validation is reused.
			expect( await gate.settle() ).toEqual( { summaries: [], problems: [], saved: [] } );
		}, 300_000 );

		it( 'validates the part again in an editor loaded anew once a block the editor knows saves differently', async () => {
			// The editor registers the block from a script, which saves the text it names.
			const script = ( saved: string ) =>
				`\nadd_action( 'init', fn() => register_block_type( 'studio-test/stamp' ) );\nadd_action( 'enqueue_block_editor_assets', fn() => wp_add_inline_script( 'wp-blocks', "wp.blocks.registerBlockType( 'studio-test/stamp', { title: 'Stamp', save: () => wp.element.createElement( 'p', null, '${ saved }' ) } );" ) );\n`;
			const functions = path.join( theme(), 'functions.php' );
			appendFileSync( functions, script( 'Old stamp' ) );
			const part = path.join( theme(), 'parts/studio-test-stamp.html' );
			writeFileSync(
				part,
				'<!-- wp:studio-test/stamp -->\n<p class="wp-block-studio-test-stamp">New stamp</p>\n<!-- /wp:studio-test/stamp -->\n'
			);
			const open = new OpenProblems( [] );
			const gate = createBlockValidationGate( host, open );
			const changes = new SiteChanges( host, open, async () => [ site ], [ blockEditorScripts ] );
			await changes.snapshot();
			gate.track( part, site.path );
			const first = await gate.settle();
			expect( first.summaries ).toEqual( [ 'parts/studio-test-stamp.html: 1 invalid block(s)' ] );
			expect( first.saved ).toEqual( [] );

			await changes.begin();
			const php = readFileSync( functions, 'utf8' );
			writeFileSync( functions, php.replace( script( 'Old stamp' ), script( 'New stamp' ) ) );
			await changes.settle();
			expect( await gate.settle() ).toMatchObject( {
				summaries: [ 'parts/studio-test-stamp.html: 1/1 blocks valid' ],
				problems: [],
			} );
			expect( await open.raise() ).toEqual( [] );
		}, 300_000 );
	}
);
