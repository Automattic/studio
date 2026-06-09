import { describe, expect, it } from 'vitest';
import {
	assertCompleteBlockMarkup,
	findArchiveLoopViolations,
	findThemeTokenReferenceViolations,
	normalizeGeneratedThemeJson,
	stripUnresolvableFontFaces,
} from 'cli/ai/tools/site-generator/theme-guards';

describe( 'stripUnresolvableFontFaces', () => {
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

	it( 'keeps a Google fontFace URL now that Google Fonts are allowed', () => {
		const { json, stripped } = stripUnresolvableFontFaces( withRemote );
		expect( json ).toContain( 'gstatic.com' );
		expect( json ).toContain( 'fontFace' );
		expect( json ).toMatch( /https?:\/\// );
		expect( JSON.parse( json ).settings.typography.fontFamilies[ 0 ].fontFamily ).toBe(
			'"Inter", system-ui, sans-serif'
		);
		expect( stripped ).toEqual( [] );
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
		const { json, stripped } = stripUnresolvableFontFaces( local );
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
		const { json, stripped } = stripUnresolvableFontFaces( tokenOnly );
		expect( JSON.parse( json ) ).toEqual( JSON.parse( tokenOnly ) );
		expect( stripped ).toEqual( [] );
	} );

	it( 'returns the input unchanged when it is not valid JSON', () => {
		const { json, stripped } = stripUnresolvableFontFaces( 'not json' );
		expect( json ).toBe( 'not json' );
		expect( stripped ).toEqual( [] );
	} );
} );

describe( 'normalizeGeneratedThemeJson', () => {
	it( 'throws on truncated JSON instead of returning corrupt theme.json', () => {
		expect( () =>
			normalizeGeneratedThemeJson(
				'{ "version": 3, "settings": { "color": { "palette": [ { "slug": "primary" } ] }'
			)
		).toThrow( /Generated theme\.json is invalid JSON/ );
	} );

	it( 'validates the rewritten JSON after dropping unresolvable local font files', () => {
		const { json, stripped } = normalizeGeneratedThemeJson(
			JSON.stringify( {
				version: 3,
				settings: {
					typography: {
						fontFamilies: [
							{
								slug: 'body',
								fontFamily: 'Inter, system-ui, sans-serif',
								fontFace: [ { src: [ 'file:./assets/inter.woff2' ] } ],
							},
						],
					},
				},
			} )
		);

		expect( () => JSON.parse( json ) ).not.toThrow();
		expect( json ).not.toContain( 'file:' );
		expect( stripped ).toEqual( [ 'body' ] );
	} );
} );

describe( 'assertCompleteBlockMarkup', () => {
	const complete =
		'<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph --></div><!-- /wp:group -->';

	it( 'accepts balanced WordPress block markup', () => {
		expect( () => assertCompleteBlockMarkup( complete ) ).not.toThrow();
	} );

	it( 'rejects content that ends inside a WordPress comment', () => {
		expect( () =>
			assertCompleteBlockMarkup( '<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph' )
		).toThrow( /unterminated HTML comment/ );
	} );

	it( 'rejects unclosed block pairs', () => {
		expect( () =>
			assertCompleteBlockMarkup(
				'<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->'
			)
		).toThrow( /unclosed WordPress block/ );
	} );

	it( 'rejects output that ends inside an HTML tag', () => {
		expect( () => assertCompleteBlockMarkup( '<!-- wp:paragraph --><p>Nearly done</p' ) ).toThrow(
			/ends inside an HTML tag/
		);
	} );
} );

describe( 'findThemeTokenReferenceViolations', () => {
	const themeJson = JSON.stringify( {
		settings: {
			color: {
				palette: [
					{ slug: 'primary', color: '#123456' },
					{ slug: 'background', color: '#ffffff' },
				],
				gradients: [ { slug: 'primary-fade', gradient: 'linear-gradient(#123456,#ffffff)' } ],
			},
			typography: {
				fontFamilies: [ { slug: 'body', fontFamily: 'Nunito, sans-serif' } ],
				fontSizes: [ { slug: 'small', size: '0.875rem' } ],
			},
			spacing: {
				spacingSizes: [ { slug: '40', size: '1.5rem' } ],
			},
		},
	} );

	it( 'flags generated files that reference slugs not declared in theme.json', () => {
		const violations = findThemeTokenReferenceViolations( themeJson, [
			{
				rel: 'parts/header.html',
				content:
					'<!-- wp:group {"backgroundColor":"cobalt","textColor":"chalk","fontFamily":"display","style":{"spacing":{"padding":{"top":"var:preset|spacing|10"}}}} --><div class="wp-block-group has-cobalt-background-color has-chalk-color has-text-color"></div><!-- /wp:group -->',
			},
		] );

		expect( violations.map( ( v ) => `${ v.type }:${ v.slug }` ) ).toEqual(
			expect.arrayContaining( [
				'color:cobalt',
				'color:chalk',
				'font-family:display',
				'spacing:10',
			] )
		);
	} );

	it( 'does not flag valid token references or WordPress marker classes', () => {
		const violations = findThemeTokenReferenceViolations( themeJson, [
			{
				rel: 'parts/header.html',
				content:
					'<!-- wp:group {"backgroundColor":"primary","textColor":"background","fontFamily":"body","fontSize":"small","style":{"spacing":{"padding":{"top":"var:preset|spacing|40"}}}} --><div class="wp-block-group has-primary-background-color has-background-color has-text-color has-body-font-family has-small-font-size"></div><!-- /wp:group -->',
			},
			{
				rel: 'style.css',
				content:
					'.site-header{color:var(--wp--preset--color--primary);font-family:var(--wp--preset--font-family--body);font-size:var(--wp--preset--font-size--small);padding:var(--wp--preset--spacing--40);}',
			},
		] );

		expect( violations ).toEqual( [] );
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
