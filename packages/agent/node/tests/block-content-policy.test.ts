import { describe, expect, it } from 'vitest';
import {
	getHtmlBlockPolicyIssues,
	validateHtmlBlockPolicy,
} from '@studio/agent/node/block-content-policy';

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
