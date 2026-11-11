import { describe, expect, it } from 'vitest';
import {
	getHtmlBlockPolicyIssues,
	validateHtmlBlockPolicy,
} from '@studio/agent/shared/block-content-policy';

describe( 'HTML block content policy', () => {
	it( 'allows inline SVG markup', () => {
		expect(
			getHtmlBlockPolicyIssues(
				'<!-- wp:html --><svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z" /></svg><!-- /wp:html -->'
			)
		).toEqual( [] );
	} );

	it( 'allows a single script block', () => {
		expect(
			getHtmlBlockPolicyIssues(
				'<!-- wp:html --><script>document.body.classList.add("ready");</script><!-- /wp:html -->'
			)
		).toEqual( [] );
	} );

	it.each( [
		{ form: '<form action="#" method="post">', lost: true },
		{ form: '<form>', lost: true },
		{ form: '<form action="https://example.us1.list-manage.com/subscribe/post">', lost: false },
	] )( 'flags $form with Jetpack Forms, and says when its entries are lost', ( { form, lost } ) => {
		const issues = getHtmlBlockPolicyIssues(
			`<!-- wp:html -->${ form }<input type="email" /></form><!-- /wp:html -->`
		);

		expect( issues ).toHaveLength( 1 );
		expect( issues[ 0 ] ).toContain(
			'saves each submission, whatever its fields, as a Form Responses post'
		);
		expect( issues[ 0 ].includes( 'what a visitor enters is lost' ) ).toBe( lost );
	} );

	// eval29 redo: a CSS marquee, a div with a marquee class, read as the exempt element.
	it.each( [
		{ html: '<marquee>Now booking</marquee>', kept: true },
		{
			html: '<div class="banner"><marquee behavior="alternate">Now booking</marquee></div>',
			kept: true,
		},
		{ html: '<div class="marquee-track"><span>Now booking</span></div>', kept: false },
		{
			html: '<div class="bl-marquee" data-marquee="1"><span>Now booking</span></div>',
			kept: false,
		},
	] )(
		'keeps core/html for a <marquee> element, not for markup named after one: $html',
		( { html, kept } ) => {
			expect( getHtmlBlockPolicyIssues( `<!-- wp:html -->${ html }<!-- /wp:html -->` ) ).toEqual(
				kept
					? []
					: [
							'core/html contains markup that should use editable blocks. core/html is kept only for a single inline `<svg>` element, a single `<script>` element, or markup holding a `<marquee>` element, which no block saves; other elements, whatever their class names, are written as the blocks that save them.',
					  ]
			);
		}
	);

	it( 'flags layout and text markup that should use core blocks', () => {
		const issues = getHtmlBlockPolicyIssues(
			'<!-- wp:html --><section class="hero"><h1>Auran</h1><p>Precision furniture.</p></section><!-- /wp:html -->'
		);

		expect( issues ).toHaveLength( 1 );
		expect( issues[ 0 ] ).toContain( 'should use editable blocks' );
	} );

	it( 'returns invalid core/html blocks from full block content', () => {
		const report =
			validateHtmlBlockPolicy( `<!-- wp:html --><svg viewBox="0 0 10 10"></svg><!-- /wp:html -->
<!-- wp:paragraph --><p>Editable text</p><!-- /wp:paragraph -->
<!-- wp:html --><section><h2>Wrapped text</h2></section><!-- /wp:html -->` );

		expect( report.totalHtmlBlocks ).toBe( 2 );
		expect( report.invalidHtmlBlocks ).toHaveLength( 1 );
		expect( report.invalidHtmlBlocks[ 0 ].content ).toContain( '<section>' );
	} );
} );
