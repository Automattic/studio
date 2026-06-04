import { describe, expect, it } from 'vitest';
import { findArchiveLoopViolations, stripRemoteFontFaces } from 'cli/ai/generation/theme-guards';

describe( 'stripRemoteFontFaces', () => {
	const withRemote = JSON.stringify(
		{
			version: 3,
			settings: {
				typography: {
					fontFamilies: [
						{
							name: 'Inter',
							slug: 'body',
							fontFamily: '"Inter", system-ui, sans-serif',
							fontFace: [
								{
									fontFamily: 'Inter',
									fontWeight: '400',
									src: [ 'https://fonts.gstatic.com/s/inter/v18/abc.woff2' ],
								},
							],
						},
					],
				},
			},
		},
		null,
		'\t'
	);

	it( 'drops a fontFace that points at a remote CDN, keeping the fontFamily stack', () => {
		const { json, stripped } = stripRemoteFontFaces( withRemote );
		expect( json ).not.toContain( 'gstatic.com' );
		expect( json ).not.toContain( 'fontFace' );
		expect( json ).not.toMatch( /https?:\/\// );
		expect( JSON.parse( json ).settings.typography.fontFamilies[ 0 ].fontFamily ).toBe(
			'"Inter", system-ui, sans-serif'
		);
		expect( stripped ).toContain( 'body' );
	} );

	it( 'drops a fontFace that points at a local file: path (no woff2 are bundled)', () => {
		const local = JSON.stringify( {
			settings: {
				typography: {
					fontFamilies: [
						{
							slug: 'heading',
							fontFamily: 'Fraunces, Georgia, serif',
							fontFace: [ { src: [ 'file:./assets/fonts/fraunces.woff2' ] } ],
						},
					],
				},
			},
		} );
		const { json, stripped } = stripRemoteFontFaces( local );
		expect( json ).not.toContain( 'file:' );
		expect( json ).not.toContain( 'fontFace' );
		expect( json ).toContain( 'Fraunces, Georgia, serif' );
		expect( stripped ).toContain( 'heading' );
	} );

	it( 'leaves a token-only theme.json untouched', () => {
		const tokenOnly = JSON.stringify( {
			settings: {
				typography: {
					fontFamilies: [
						{ slug: 'body', fontFamily: 'system-ui, sans-serif' },
						{ slug: 'heading', fontFamily: 'Georgia, serif' },
					],
				},
			},
		} );
		const { json, stripped } = stripRemoteFontFaces( tokenOnly );
		expect( JSON.parse( json ) ).toEqual( JSON.parse( tokenOnly ) );
		expect( stripped ).toEqual( [] );
	} );

	it( 'returns the input unchanged when it is not valid JSON', () => {
		const { json, stripped } = stripRemoteFontFaces( 'not json' );
		expect( json ).toBe( 'not json' );
		expect( stripped ).toEqual( [] );
	} );
} );

describe( 'findArchiveLoopViolations', () => {
	const bounded =
		'<!-- wp:query {"query":{"postType":"untold_artists","perPage":12}} --><!-- wp:post-template --><!-- wp:post-title /--><!-- wp:post-featured-image /--><!-- /wp:post-template --><!-- /wp:query -->';

	it( 'passes a bounded, primitive-only single loop', () => {
		expect( findArchiveLoopViolations( bounded ) ).toEqual( [] );
	} );

	it( 'flags wp:post-content inside a post-template', () => {
		const html =
			'<!-- wp:query {"query":{"postType":"untold_artists","perPage":12}} --><!-- wp:post-template --><!-- wp:post-content /--><!-- /wp:post-template --><!-- /wp:query -->';
		expect( findArchiveLoopViolations( html ).map( ( v ) => v.code ) ).toContain(
			'post-content-in-post-template'
		);
	} );

	it( 'flags perPage:-1', () => {
		const html =
			'<!-- wp:query {"query":{"postType":"untold_artists","perPage":-1}} --><!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template --><!-- /wp:query -->';
		expect( findArchiveLoopViolations( html ).map( ( v ) => v.code ) ).toContain(
			'unbounded-perpage'
		);
	} );

	it( 'flags a missing perPage cap', () => {
		const html =
			'<!-- wp:query {"query":{"postType":"untold_artists"}} --><!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template --><!-- /wp:query -->';
		expect( findArchiveLoopViolations( html ).map( ( v ) => v.code ) ).toContain(
			'missing-perpage'
		);
	} );

	it( 'flags a nested wp:query inside a post-template', () => {
		const html =
			'<!-- wp:query {"query":{"postType":"untold_stages","perPage":6}} --><!-- wp:post-template --><!-- wp:query {"query":{"postType":"untold_stages","perPage":6}} --><!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template --><!-- /wp:query --><!-- /wp:post-template --><!-- /wp:query -->';
		expect( findArchiveLoopViolations( html ).map( ( v ) => v.code ) ).toContain(
			'nested-query-in-post-template'
		);
	} );

	it( 'passes the featured+rest two-sibling-query shape', () => {
		const featured =
			'<!-- wp:query {"query":{"postType":"untold_artists","perPage":1}} --><!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template --><!-- /wp:query -->' +
			'<!-- wp:query {"query":{"postType":"untold_artists","perPage":6,"offset":1}} --><!-- wp:post-template --><!-- wp:post-title /--><!-- /wp:post-template --><!-- /wp:query -->';
		expect( findArchiveLoopViolations( featured ) ).toEqual( [] );
	} );
} );
