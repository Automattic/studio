import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlockValidationGate } from 'cli/ai/block-validation-gate';
import { getWrittenFiles, runFileToolHook } from 'cli/ai/runtimes/hooks';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';

vi.mock( 'cli/lib/cli-config/sites', () => ( { findSiteByFolder: vi.fn() } ) );

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
			gate
		);

	expect( await post( header ) ).toEqual( {
		hookSpecificOutput: {
			hookEventName: 'PostToolUse',
			additionalContext: [
				'Block validation: parts/header.html: 1/1 blocks valid',
				'Note: WordPress renders the template part header from its copy saved in the Site Editor (post 14), not from this file.',
			].join( '\n' ),
		},
	} );
	expect( await post( '/elsewhere/src/index.ts' ) ).toBeUndefined();
} );

const DESIGN_MD =
	'---\ncolors:\n  primary: "#c2552b"\n  background: "#fbf6ee"\ntypography:\n  body:\n    fontFamily: "Inter"\n    fontWeight: 400\n---\n\n# Overview\n';

afterEach( () => vi.unstubAllGlobals() );

// DESIGN.md is the look; the theme built on it carries its tokens whichever
// of the two the agent writes. A theme WordPress updates is left alone.
it.each( [
	{ written: 'wp-content/themes/bakery/theme.json', theme: 'bakery' },
	{ written: 'DESIGN.md', theme: 'bakery' },
	{ written: 'wp-content/themes/bakery-parent/theme.json', theme: undefined },
] )( 'writes DESIGN.md into the theme after a write to $written', async ( { written, theme } ) => {
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: string ) =>
			url.startsWith( 'https://fonts.googleapis.com/' )
				? new Response(
						"/* latin */\n@font-face {\n  font-family: 'Inter';\n  font-style: normal;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/inter.woff2) format('woff2');\n}\n"
				  )
				: new Response( new Uint8Array( [ 1 ] ) )
		)
	);
	writeFileSync( path.join( site.root, 'DESIGN.md' ), DESIGN_MD );
	const ownPalette = { settings: { color: { palette: [ { slug: 'ink', color: '#111' } ] } } };
	for ( const slug of [ 'bakery', 'bakery-parent' ] ) {
		writeFileSync(
			path.join( site.root, 'wp-content/themes', slug, 'theme.json' ),
			JSON.stringify( { version: 3, ...ownPalette } )
		);
	}

	const output = await runFileToolHook( {
		hook_event_name: 'PostToolUse',
		tool_name: 'Write',
		tool_input: { file_path: path.join( site.root, written ) },
	} );

	for ( const slug of [ 'bakery', 'bakery-parent' ] ) {
		const themeDir = path.join( site.root, 'wp-content/themes', slug );
		const themeJson = JSON.parse( readFileSync( path.join( themeDir, 'theme.json' ), 'utf8' ) );
		const palette = themeJson.settings.color.palette.map(
			( color: { slug: string } ) => color.slug
		);
		if ( slug === theme ) {
			expect( palette ).toEqual( [ 'ink', 'primary', 'background' ] );
			expect( themeJson.styles.typography.fontFamily ).toBe( 'var:preset|font-family|inter' );
			expect( themeJson.settings.typography.fontFamilies[ 0 ].fontFace ).toHaveLength( 1 );
			expect( existsSync( path.join( themeDir, 'assets/fonts/inter' ) ) ).toBe( true );
		} else {
			expect( palette ).toEqual( [ 'ink' ] );
		}
	}
	expect( output?.hookSpecificOutput ).toEqual(
		theme && {
			hookEventName: 'PostToolUse',
			additionalContext: `Note: Studio wrote DESIGN.md's tokens into wp-content/themes/${ theme }/theme.json under DESIGN.md's names: colors primary, background; font families inter; fonts of the styles body. DESIGN.md holds these values; change the look there.`,
		}
	);
} );
