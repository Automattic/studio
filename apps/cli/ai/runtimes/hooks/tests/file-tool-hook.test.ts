import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlockValidationGate } from 'cli/ai/block-validation-gate';
import { getWrittenFiles, runFileToolHook } from 'cli/ai/runtimes/hooks';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';

vi.mock( 'cli/lib/cli-config/sites', () => ( { findSiteByFolder: vi.fn(), getSiteUrl: vi.fn() } ) );
vi.mock( 'cli/lib/cli-config/core', () => ( { readCliConfig: vi.fn() } ) );

let site: ReturnType< typeof createSite >;
beforeEach( () => {
	site = createSite();
	vi.mocked( findSiteByFolder ).mockImplementation( async ( folder ) =>
		arePathsEqual( folder, site.root )
			? ( { id: 'site', name: 'Bakery', path: site.root } as Awaited<
					ReturnType< typeof findSiteByFolder >
			  > )
			: undefined
	);
	vi.mocked( readCliConfig ).mockResolvedValue( {
		sites: [ { id: 'site', name: 'Bakery', path: site.root } ],
	} as Awaited< ReturnType< typeof readCliConfig > > );
} );

// Claude Code's Write and Edit name the file; Codex's apply_patch carries a patch.
it.each( [
	[ 'Write', { file_path: '/site/wp-content/themes/a/style.css', content: '' }, [ 'style.css' ] ],
	[
		'Edit',
		{ file_path: 'parts/header.html', old_string: '', new_string: '' },
		[ 'parts/header.html' ],
	],
	[
		'apply_patch',
		{
			command:
				'*** Begin Patch\n*** Add File: parts/footer.html\n+x\n*** Update File: style.css\n*** Move to: theme.css\n@@\n*** Delete File: old.css\n*** End Patch',
		},
		[ 'parts/footer.html', 'style.css', 'theme.css' ],
	],
] )( 'finds the files %s writes', ( toolName, toolInput, files ) => {
	const cwd = '/site/wp-content/themes/a';
	expect(
		getWrittenFiles( { tool_name: toolName, tool_input: toolInput, cwd } ).map( ( file ) =>
			path.relative( cwd, file ).split( path.sep ).join( '/' )
		)
	).toEqual( files );
} );

it( 'refuses a write to a file a WordPress or theme update replaces, naming where it belongs', async () => {
	const pre = ( file: string ) =>
		runFileToolHook( {
			hook_event_name: 'PreToolUse',
			tool_name: 'Edit',
			tool_input: { file_path: path.join( site.root, file ) },
		} );
	expect( await pre( 'wp-includes/version.php' ) ).toEqual( {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: expect.stringContaining( 'Make the change in wp-content/' ),
		},
	} );
	expect(
		( await pre( 'wp-content/themes/bakery-parent/style.css' ) )?.hookSpecificOutput
	).toMatchObject( { permissionDecisionReason: expect.stringContaining( 'child theme' ) } );
	expect( await pre( 'wp-content/themes/bakery/style.css' ) ).toBeUndefined();
} );

it( 'adds to a write the block validation and what WordPress renders instead of the file', async () => {
	site.save( 14, 'wp_template_part', 'header' );
	const header = path.join( site.root, 'wp-content/themes/bakery/parts/header.html' );
	mkdirSync( path.dirname( header ), { recursive: true } );
	writeFileSync( header, '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->' );
	const gate = new BlockValidationGate( async () => ( {
		contentHash: 'x',
		summary: 'parts/header.html: 1/1 blocks valid',
	} ) );
	const post = ( file: string ) =>
		runFileToolHook(
			{ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file } },
			() => gate
		);

	expect( await post( header ) ).toEqual( {
		hookSpecificOutput: {
			hookEventName: 'PostToolUse',
			additionalContext: [
				'<studio-notes>',
				'Block validation: parts/header.html: 1/1 blocks valid',
				'WordPress renders the template part header from its copy saved in the Site Editor (post 14), not from this file.',
				'</studio-notes>',
			].join( '\n' ),
		},
	} );
	expect( await post( '/elsewhere/src/index.ts' ) ).toBeUndefined();
} );

afterEach( () => vi.unstubAllGlobals() );

// A theme.json font family without font files gets them from Google Fonts, in
// the weights the theme uses.
const FACE = { fontFamily: 'Inter', src: [ 'file:./assets/fonts/inter.woff2' ] };
it.each( [
	{
		theme: 'bakery',
		family: 'Inter',
		fontFace: undefined,
		note: 'Studio downloaded the font files of Inter from Google Fonts into wp-content/themes/bakery/assets/fonts and declared them as their fontFace in theme.json.',
	},
	{
		theme: 'bakery',
		family: 'Nope Sans',
		fontFace: undefined,
		note: 'Nope Sans has no font files in wp-content/themes/bakery/theme.json, and Google Fonts did not provide them (https://fonts.googleapis.com/css2?family=Nope+Sans:wght@400;600&display=swap responded with HTTP 400). Put its files in wp-content/themes/bakery/assets/fonts and declare them as its fontFace, or choose a Google Fonts family.',
	},
	{ theme: 'bakery', family: 'Inter', fontFace: [ FACE ], note: undefined },
] )(
	'self-hosts $family in $theme after a theme.json write, with font files: $fontFace',
	async ( { theme, family, fontFace, note } ) => {
		const fetch = vi.fn( async ( url: string ) =>
			url.includes( 'Nope' )
				? new Response( '', { status: 400 } )
				: url.startsWith( 'https://fonts.googleapis.com/' )
				? new Response(
						"/* latin */\n@font-face {\n  font-family: 'Inter';\n  font-style: normal;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/inter.woff2) format('woff2');\n}\n"
				  )
				: new Response( new Uint8Array( [ 1 ] ) )
		);
		vi.stubGlobal( 'fetch', fetch );
		const themeDir = path.join( site.root, 'wp-content/themes', theme );
		const start = {
			version: 3,
			settings: {
				typography: {
					fontFamilies: [
						{ slug: 'body', name: family, fontFamily: `"${ family }", sans-serif`, fontFace },
					],
				},
			},
			styles: {
				typography: { fontFamily: 'var:preset|font-family|body' },
				elements: { h1: { typography: { fontWeight: '600' } } },
			},
		};
		writeFileSync( path.join( themeDir, 'theme.json' ), JSON.stringify( start ) );

		const output = await runFileToolHook( {
			hook_event_name: 'PostToolUse',
			tool_name: 'Write',
			tool_input: { file_path: path.join( themeDir, 'theme.json' ) },
		} );

		const themeJson = JSON.parse( readFileSync( path.join( themeDir, 'theme.json' ), 'utf8' ) );
		const hosted = note?.startsWith( 'Studio downloaded' );
		expect( themeJson.settings.typography.fontFamilies[ 0 ].fontFace ).toEqual(
			hosted
				? [
						{
							fontFamily: 'Inter',
							fontStyle: 'normal',
							fontWeight: '400',
							src: [ 'file:./assets/fonts/inter/inter-400-latin.woff2' ],
						},
				  ]
				: fontFace
		);
		expect( existsSync( path.join( themeDir, 'assets/fonts/inter' ) ) ).toBe( !! hosted );
		if ( hosted ) {
			expect( fetch ).toHaveBeenCalledWith(
				'https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap',
				expect.anything()
			);
		}
		expect( output?.hookSpecificOutput ).toEqual(
			note && {
				hookEventName: 'PostToolUse',
				additionalContext: `<studio-notes>\n${ note }\n</studio-notes>`,
			}
		);
	}
);

// A theme.json that names a palette color after a class WordPress already
// gives blocks gets a note; a theme without a thumbnail gets its design board.
it.each( [
	{ slug: 'text', screenshot: undefined, note: true, thumbnail: true },
	{ slug: 'ink', screenshot: undefined, note: false, thumbnail: true },
	{ slug: 'ink', screenshot: 'screenshot.jpg', note: false, thumbnail: false },
] )(
	'after a theme.json write with palette $slug and $screenshot, notes the clash: $note, saves a thumbnail: $thumbnail',
	async ( { slug, screenshot, note, thumbnail } ) => {
		const themeDir = path.join( site.root, 'wp-content/themes/bakery' );
		if ( screenshot ) {
			writeFileSync( path.join( themeDir, screenshot ), '' );
		}
		writeFileSync(
			path.join( themeDir, 'theme.json' ),
			JSON.stringify( {
				version: 3,
				settings: {
					color: {
						palette: [
							{ slug: 'paper', color: '#ffffff' },
							{ slug, color: '#111111' },
						],
					},
				},
				styles: { typography: { fontFamily: 'Georgia, serif' } },
			} )
		);

		const output = await runFileToolHook( {
			hook_event_name: 'PostToolUse',
			tool_name: 'Write',
			tool_input: { file_path: path.join( themeDir, 'theme.json' ) },
		} );

		const hook = output?.hookSpecificOutput;
		const context = hook && 'additionalContext' in hook ? hook.additionalContext : '';
		expect( context.includes( 'names a palette color `text`' ) ).toBe( note );
		expect( context.includes( 'screenshot.png' ) ).toBe( thumbnail );
		const png = path.join( themeDir, 'screenshot.png' );
		expect( existsSync( png ) ).toBe( thumbnail );
		if ( thumbnail ) {
			// The PNG header: width and height are big-endian at bytes 16 and 20.
			const header = readFileSync( png );
			expect( [ header.readUInt32BE( 16 ), header.readUInt32BE( 20 ) ] ).toEqual( [ 1200, 900 ] );
		}
	},
	60_000
);

// An image shown from a host other than the site's, in block markup or theme CSS.
it.each( [
	{
		file: 'templates/index.html',
		content:
			'<!-- wp:image --><figure><img src="https://images.example.com/a.jpg" alt=""/></figure>',
		host: 'images.example.com',
	},
	{
		file: 'templates/index.html',
		content: '<img src="http://localhost:8881/wp-content/uploads/a.png" alt=""/>',
		host: undefined,
	},
	{
		file: 'style.css',
		content:
			'/*\nTheme Name: Bakery\n*/\n.hero { background: #000 url("https://cdn.example.org/b.jpg"); }',
		host: 'cdn.example.org',
	},
	{
		file: 'style.css',
		content:
			'/*\nTheme Name: Bakery\n*/\n@font-face { src: url(https://fonts.example.com/a.woff2); }',
		host: undefined,
	},
] )( 'notes images in $file from $host', async ( { file, content, host } ) => {
	site.setOptions( { siteurl: 'http://localhost:8881' } );
	const written = path.join( site.root, 'wp-content/themes/bakery', file );
	mkdirSync( path.dirname( written ), { recursive: true } );
	writeFileSync( written, content );
	const output = await runFileToolHook( {
		hook_event_name: 'PostToolUse',
		tool_name: 'Write',
		tool_input: { file_path: written },
	} );
	const notes = JSON.stringify( output ?? {} );
	expect( notes.includes( 'which this site does not hold' ) ).toBe( Boolean( host ) );
	expect(
		notes.includes( `wp-content/themes/bakery/${ file } shows images from ${ host },` )
	).toBe( Boolean( host ) );
} );

// A shell call can save post content by any route; the hook pair reports what
// it changed, keeping PreToolUse's snapshot for PostToolUse.
it( 'reports the block validation of post content a shell call changed', async () => {
	site.save( 9, 'page', 'home', '<!-- wp:paragraph -->\n<p>Hi</p>\n<!-- /wp:paragraph -->' );
	const hook = ( event: string ) =>
		runFileToolHook( {
			hook_event_name: event,
			tool_name: 'Bash',
			tool_input: { command: 'wp post update 9 tmp/home.txt' },
			session_id: `session-${ site.root }`,
		} );
	await hook( 'PreToolUse' );
	site.edit( 9, '<!-- wp:html -->\n<div class="hero"><h1>Hi</h1></div>\n<!-- /wp:html -->' );
	expect( await hook( 'PostToolUse' ) ).toEqual( {
		hookSpecificOutput: {
			hookEventName: 'PostToolUse',
			additionalContext: expect.stringContaining(
				'Bakery page 9 "": 1 core/html block(s) must become editable blocks'
			),
		},
	} );
	// Stopping continues the turn with the problem still open, once.
	expect( await hook( 'Stop' ) ).toEqual( {
		decision: 'block',
		reason: expect.stringMatching(
			/^<studio-checks>\nStudio checked the sites this turn changed:[^]*1 core\/html block\(s\) must become editable blocks/
		),
	} );
	expect( await hook( 'Stop' ) ).toBeUndefined();
} );
