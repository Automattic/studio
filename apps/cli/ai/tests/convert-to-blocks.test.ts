import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertToBlocksTool } from 'cli/ai/tools/convert-to-blocks';
import { resolveSite } from 'cli/ai/tools/utils';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/ai/tools/utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/tools/utils') >() ),
	resolveSite: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/sites', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/cli-config/sites') >() ),
	getSiteUrl: () => 'http://localhost:1',
	findSiteByFolder: vi.fn( async () => undefined ),
} ) );
vi.mock( 'cli/lib/import-runtime', () => ( {
	resolvePhpTransformer: async () => ( { bootstrap: TRANSFORMER, version: 'test' } ),
} ) );
// The block editor is not served here: the conversion's validation reports
// what it was given, and is tested where the editor runs.
vi.mock( 'cli/ai/block-validator', () => ( {
	validateBlocks: async () => ( {
		error: 'no editor',
		invalidBlocks: 0,
		totalBlocks: 0,
		results: [],
	} ),
} ) );
vi.mock( 'cli/ai/block-validation-gate', () => ( {
	sitePresetValues: async () => ( { colors: [], fontSizes: [], spacingSizes: [] } ),
	validateBlockMarkup: async ( _content: string, label: string ) => ( {
		summary: `${ label }: not validated (no editor)`,
	} ),
} ) );

// A real WordPress install and a Blocks Engine PHP transformer
// (php-transformer.php from its release zip), when both are given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;
const TRANSFORMER = process.env.STUDIO_TEST_PHP_TRANSFORMER ?? '';

const THEME = 'harbor-lantern-studio-test';
const STYLE = `/*
Theme Name: Harbor Lantern
*/
.lantern-row { display: flex; justify-content: space-between; gap: 2rem; }
.lantern-card { padding: 1.5rem; border: 1px solid #ccc; }
`;
const FUNCTIONS = `<?php
add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'harbor-lantern', get_stylesheet_uri() );
} );
`;
const CLASSIC = `<section class="lantern-row">
	<div class="lantern-card"><h2>Night ferries</h2><p>Boats leave the harbor every hour.</p></div>
	<div class="lantern-card"><h2>Lantern walk</h2><p>Meet at the pier at dusk.</p></div>
</section>
`;

// theme.json gives h3 a fluid preset size and the flow layout a block gap.
const THEME_JSON = JSON.stringify( {
	version: 3,
	settings: {
		spacing: { blockGap: true },
		typography: {
			fontSizes: [
				{ slug: 'lantern-display', name: 'Display', size: 'clamp(1.75rem, 3vw, 2.25rem)' },
			],
		},
	},
	styles: {
		spacing: { blockGap: '1.5rem' },
		elements: { h3: { typography: { fontSize: 'var:preset|font-size|lantern-display' } } },
	},
} );
const CARD_STYLE = '.lantern-card { display: flex; flex-direction: column; }\n';
const CARD = `<div class="lantern-card"><h3>Night ferries</h3><p>Boats leave the harbor every hour.</p></div>
`;

describe.runIf( WORDPRESS && TRANSFORMER )( 'convert_to_blocks', () => {
	let site: SiteData;
	let theme: string;
	beforeEach( async () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'convert-to-blocks-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = { id: 'site', name: 'Harbor', path: root } as SiteData;
		vi.mocked( resolveSite ).mockResolvedValue( site );
		theme = path.join( root, 'wp-content', 'themes', THEME );
		mkdirSync( path.join( theme, 'parts' ), { recursive: true } );
		writeFileSync( path.join( theme, 'style.css' ), STYLE );
		writeFileSync( path.join( theme, 'parts', 'section.html' ), CLASSIC );
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
		db.prepare(
			"UPDATE wp_options SET option_value = ? WHERE option_name IN ('stylesheet', 'template')"
		).run( THEME );
		db.prepare( 'UPDATE wp_posts SET post_content = ? WHERE ID = 1' ).run( CLASSIC );
		db.close();
	} );
	afterEach( () => rmSync( site.path, { recursive: true, force: true } ) );

	const convert = async ( args: { file?: string; postId?: number } ) => {
		const result = await convertToBlocksTool.rawHandler(
			{ nameOrPath: site.path, ...args },
			{ onProgress: () => {} }
		);
		return ( result.content[ 0 ] as { text: string } ).text;
	};
	const postContent = async () => {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( path.join( site.path, 'wp-content/database/.ht.sqlite' ) );
		const row = db.prepare( 'SELECT post_content FROM wp_posts WHERE ID = 1' ).get() as {
			post_content: string;
		};
		db.close();
		return row.post_content;
	};

	it.each( [
		[
			'with functions.php',
			FUNCTIONS,
			`${ FUNCTIONS.trimEnd() }\n\nrequire_once __DIR__ . '/blocks-engine-styles.php';\n`,
		],
		[
			'with functions.php closing PHP',
			`${ FUNCTIONS }?>\n`,
			`${ FUNCTIONS }?>\n<?php require_once __DIR__ . '/blocks-engine-styles.php';\n`,
		],
	] )(
		'saves a theme file as blocks and loads its support stylesheets %s',
		async ( _name, functions, expected ) => {
			writeFileSync( path.join( theme, 'functions.php' ), functions );
			const file = path.join( theme, 'parts', 'section.html' );
			const report = await convert( { file } );

			expect( report ).toContain(
				`Saved wp-content/themes/${ THEME }/parts/section.html as blocks.`
			);
			const saved = readFileSync( file, 'utf8' );
			expect( saved ).toMatch( /^<!-- wp:/ );
			expect( saved ).toContain( 'Night ferries' );
			expect( saved ).toContain( 'Meet at the pier at dusk.' );
			expect( readFileSync( path.join( theme, 'functions.php' ), 'utf8' ) ).toBe( expected );
			const sheets = readdirSync( path.join( theme, 'assets/css/blocks-engine' ) );
			expect( sheets.length ).toBeGreaterThan( 0 );
			sheets.forEach( ( sheet ) =>
				expect( sheet ).toMatch(
					/^(before|after)-author\.(both|frontend|editor)\.[0-9a-f]{16}\.css$/
				)
			);

			// Converting again keeps one require.
			writeFileSync( file, CLASSIC );
			await convert( { file } );
			expect( readFileSync( path.join( theme, 'functions.php' ), 'utf8' ) ).toBe( expected );
		},
		120_000
	);

	it( 'saves a post as blocks', async () => {
		const report = await convert( { postId: 1 } );

		expect( report ).toContain( 'Saved post 1 as blocks.' );
		const saved = await postContent();
		expect( saved ).toMatch( /^<!-- wp:/ );
		expect( saved ).toContain( 'Boats leave the harbor every hour.' );
	}, 120_000 );

	it( 'converts with the theme.json styles and block gap the site renders with', async () => {
		writeFileSync( path.join( theme, 'theme.json' ), THEME_JSON );
		writeFileSync( path.join( theme, 'functions.php' ), FUNCTIONS );
		writeFileSync( path.join( theme, 'style.css' ), `${ STYLE }${ CARD_STYLE }` );
		const file = path.join( theme, 'parts', 'section.html' );
		writeFileSync( file, CARD );
		await convert( { file } );

		// The card's flex column keeps each margin; the h3's em margins follow
		// its fluid theme.json size instead of being frozen to pixels.
		const saved = readFileSync( file, 'utf8' );
		expect( saved ).toContain(
			'<h3 class="wp-block-heading" style="margin-top:1em;margin-bottom:1em">Night ferries</h3>'
		);
	}, 120_000 );

	it( 'saves block markup left open, which the page shows twice, as its own HTML once', async () => {
		const file = path.join( theme, 'parts', 'section.html' );
		// The second paragraph's opener has no closer, and the group's closer
		// closes it: the group and the first paragraph are open at the end.
		writeFileSync(
			file,
			'<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>Night ferries</p><!-- wp:paragraph --><p>Meet at the pier at dusk.</p></div><!-- /wp:group -->\n'
		);
		const report = await convert( { file } );

		expect( report ).toContain(
			`Saved wp-content/themes/${ THEME }/parts/section.html as blocks.`
		);
		expect( report ).toContain( 'The block markup ends with 2 blocks open' );
		const saved = readFileSync( file, 'utf8' );
		expect( saved.split( 'Night ferries' ) ).toHaveLength( 2 );
		expect( saved.split( 'Meet at the pier at dusk.' ) ).toHaveLength( 2 );
	}, 120_000 );

	it( 'saves block markup with one block left open, which the page shows once, without a note', async () => {
		const file = path.join( theme, 'parts', 'section.html' );
		writeFileSync(
			file,
			'<!-- wp:group --><div class="wp-block-group"><!-- wp:paragraph --><p>Night ferries</p><!-- /wp:paragraph --></div>\n'
		);
		const report = await convert( { file } );

		expect( report ).toContain(
			`Saved wp-content/themes/${ THEME }/parts/section.html as blocks.`
		);
		expect( report ).not.toContain( 'blocks open' );
	}, 120_000 );

	it( 'leaves the file unchanged when the page would lose text', async () => {
		const file = path.join( theme, 'parts', 'section.html' );
		// A form control's text is not carried into blocks.
		const withForm = `${ CLASSIC }<form><label>Name <input name="n"></label><textarea>Ship log entry</textarea></form>\n`;
		writeFileSync( file, withForm );
		const report = await convert( { file } );

		expect( report ).toContain( 'is unchanged' );
		expect( report ).toContain( 'Ship log entry' );
		expect( readFileSync( file, 'utf8' ) ).toBe( withForm );
	}, 120_000 );
} );
