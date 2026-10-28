import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	bindNavigationLinks,
	blocksSavingElements,
	cleanupValidatorPages,
	dropCommentsBetweenBlocks,
	insertedTemplates,
	storePresetValues,
	validateBlocks,
} from 'cli/ai/block-validator';
import { getSharedBrowser } from 'cli/ai/browser-utils';

// Runs the site's own block editor, so it needs a running WordPress site:
// STUDIO_BLOCK_EDITOR_URL=http://localhost:8881 npx vitest run block-validator
const siteUrl = process.env.STUDIO_BLOCK_EDITOR_URL;
// The same site's folder, for cases that add a plugin to it.
const sitePath = process.env.STUDIO_BLOCK_EDITOR_PATH;

const group = ( attrs: string, inner: string ) =>
	`<!-- wp:group ${ attrs } -->\n${ inner }\n<!-- /wp:group -->`;
const paragraph = ( attrs: string, html: string ) =>
	`<!-- wp:paragraph ${ attrs } -->\n${ html }\n<!-- /wp:paragraph -->`;

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
			name: 'keeps the block as written when it renders the value too',
			markup: cover(
				'<div class="wp-block-cover" style="min-height:100dvh"><span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span><div class="wp-block-cover__inner-container"></div></div>'
			),
			issue: coverIssue,
			losses: [
				{ place: '/0', blockName: 'core/cover', lost: 'drop the styles min-height:100dvh' },
			],
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
		async ( { markup, issue, losses } ) => {
			const report = await validateBlocks( markup, siteUrl! );
			expect( report.results[ 0 ].issues ).toContain( issue );
			expect( report.proposedFix?.losses ).toEqual( losses );
			expect( report.proposedFix?.report.invalidBlocks ).toBe( 0 );
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
	] )(
		'stores the value a class names where $name saves it from',
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

	it.each< { name: string; written: string; losses: { place: string; lost: string }[] } >( [
		{
			name: 'a flex layout its layout attribute already shows',
			written:
				'<!-- wp:group {"layout":{"type":"flex","flexWrap":"wrap","justifyContent":"center"},"style":{"spacing":{"blockGap":"1.4rem"}}} -->\n<div class="wp-block-group" style="display:flex;flex-wrap:wrap;gap:1.4rem;align-items:center"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			losses: [],
		},
		{
			name: 'a display its layout attribute shows otherwise',
			written:
				'<!-- wp:group {"layout":{"type":"flex","flexWrap":"nowrap"}} -->\n<div class="wp-block-group" style="display:inline-flex;flex-wrap:nowrap"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			losses: [ { place: '/0', lost: 'drop the styles display:inline-flex' } ],
		},
		{
			// In its row of buttons, which is flex, the width is the button's own.
			name: 'a width that sizes the block where it sits',
			written:
				'<!-- wp:buttons -->\n<div class="wp-block-buttons"><!-- wp:button -->\n<div class="wp-block-button" style="width:100%"><a class="wp-block-button__link wp-element-button">Book</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->',
			losses: [ { place: '/0/0', lost: 'drop the styles width:100%' } ],
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
			name: 'a class that shows the block otherwise',
			written:
				'<!-- wp:cover {"dimRatio":70,"overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim-60 has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [ { place: '/0', lost: 'drop the classes has-background-dim-60' } ],
		},
		{
			// Its save names no dim for 50, which has-background-dim shows.
			name: 'a class the stylesheets give what the fix shows',
			written:
				'<!-- wp:cover {"dimRatio":50,"overlayColor":"contrast","isUserOverlayColor":true} -->\n<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-contrast-background-color has-background-dim-50 studio-test-shade has-background-dim"></span><div class="wp-block-cover__inner-container"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div></div>\n<!-- /wp:cover -->',
			losses: [ { place: '/0', lost: 'drop the classes studio-test-shade' } ],
		},
		{
			// has-border-color gives the image a solid border (common.css).
			name: 'a class that shows the block a border its fix leaves out',
			written:
				'<!-- wp:image {"id":9} -->\n<figure class="wp-block-image"><img src="https://example.com/a.png" alt="" class="has-border-color wp-image-9"/></figure>\n<!-- /wp:image -->',
			losses: [ { place: '/0', lost: 'drop the classes has-border-color' } ],
		},
		{
			// The editor's own styles for its blocks set it there.
			name: 'a style only the editor gives its blocks',
			written:
				'<!-- wp:group -->\n<div class="wp-block-group" style="position:relative"><!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph --></div>\n<!-- /wp:group -->',
			losses: [ { place: '/0', lost: 'drop the styles position:relative' } ],
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

	it( 'reads a list the editor migrates from bare items as losing nothing beside a block that loses something', async () => {
		const report = await validateBlocks(
			'<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity" style="opacity:0.4"/>\n<!-- /wp:separator -->\n\n<!-- wp:list {"className":"hours"} -->\n<ul class="wp-block-list hours"><li><span>Monday</span><strong>7 am</strong></li>\n<li>Sunday</li></ul>\n<!-- /wp:list -->',
			siteUrl!
		);
		expect( report.proposedFix?.losses ).toEqual( [
			{ place: '/0', blockName: 'core/separator', lost: 'drop the styles opacity:0.4' },
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
		},
		{
			name: 'a style no block attribute saves, beside one it does',
			written:
				'<!-- wp:paragraph -->\n<p style="font-size:1.1rem;opacity:0.92">Hi</p>\n<!-- /wp:paragraph -->',
			lost: 'drop the styles opacity:0.92',
		},
		{
			// The comment's font size preset and the written size both name one.
			name: 'a style its attributes already set otherwise',
			written:
				'<!-- wp:button {"fontSize":"small"} -->\n<div class="wp-block-button has-custom-font-size" style="font-size:0.9rem"><a class="wp-block-button__link wp-element-button">Book</a></div>\n<!-- /wp:button -->',
			lost: 'drop the styles font-size:0.9rem',
		},
		{
			// core/image saves its border on the img.
			name: 'a style the block saves on another element',
			written:
				'<!-- wp:image -->\n<figure class="wp-block-image" style="border-top-left-radius:12px"><img src="https://example.com/a.jpg" alt=""/></figure>\n<!-- /wp:image -->',
			lost: 'drop the styles border-top-left-radius:12px',
		},
	] )(
		'keeps the block as written for $name',
		async ( { written, lost } ) => {
			const report = await validateBlocks( written, siteUrl! );
			expect( report.proposedFix?.losses ).toEqual( [
				{ place: '/0', blockName: expect.any( String ), lost },
			] );
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
			{ place: '/0', blockName: 'core/cover', lost: 'move core/paragraph out of div' },
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
		},
		{
			name: 'its styles',
			written: paragraph( '{}', '<p style="position:sticky;top:0">Eyebrow</p>' ),
			blockName: 'core/paragraph',
			lost: 'drop the styles position:sticky; top:0px',
		},
		{
			name: 'its text',
			written: paragraph( '{}', '<div>Lost words</div>' ),
			blockName: 'core/paragraph',
			lost: 'change the text',
		},
	] )(
		'names the block whose fix would lose $name, keeps it as written and saves the fix for the rest',
		async ( { written, blockName, lost } ) => {
			const markup = group(
				'{}',
				`${ paragraph( '{"textAlign":"center"}', '<p>Centered</p>' ) }\n${ written }`
			);
			const report = await validateBlocks( markup, siteUrl! );
			expect( report.proposedFix?.losses ).toEqual( [ { place: '/0/1', blockName, lost } ] );
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
		expect( ( await validateBlocks( spacer, siteUrl! ) ).invalidBlocks ).toBe( 0 );
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
			// The editor's parse wraps the line break in a paragraph (autop).
			expected: { content: `<p></p>\n\n${ hello }\n\n${ hello }`, comments: 1 },
		},
		{
			name: 'no comments',
			markup: hello,
			expected: { content: hello, comments: 0 },
		},
	] )( 'drops what renders nothing between blocks: $name', async ( { markup, expected } ) => {
		expect( await dropCommentsBetweenBlocks( markup, siteUrl! ) ).toEqual( expected );
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
		const dropped = ( await dropCommentsBetweenBlocks( markup, siteUrl! ) ).content;
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
