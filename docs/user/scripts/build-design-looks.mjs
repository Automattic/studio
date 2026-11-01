/**
 * Renders the design looks Studio Code offers in the design picker shot
 * (`screenshots/demo-site/design-looks/`): each look in `looks.json` is a
 * DESIGN.md draft and one of the bakery's photos, drawn as a design board by
 * the agent's own `renderDesignBoard`, the way `present_design_options` does,
 * and saved as `<file>` next to it. The shot plays them back as a pending
 * question (see `agent-turns/` and the `stubAgentRuns` / `playAgentTurn`
 * helpers), so no model runs. Run it after editing a look:
 *
 *   npm run design-looks:build
 *
 * The photos come from the demo site's `.cache/` (`npm run demo-site:build`
 * fills it), and the boards load their fonts from Google Fonts.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { DEMO_SITE_DIR, readJson, ROOT } from './lib/common.mjs';

const LOOKS_DIR = path.join( DEMO_SITE_DIR, 'design-looks' );
const PHOTOS_DIR = path.join( DEMO_SITE_DIR, 'wren-and-barley', '.cache' );
const DESIGN_BOARD = path.resolve( ROOT, '../../packages/agent/node/design-board.ts' );
// `present_design_options` renders each look in this frame.
const VIEWPORT = { width: 1200, height: 900 };

const temp = await mkdtemp( path.join( tmpdir(), 'studio-design-looks-' ) );
const browser = await chromium.launch();
try {
	// The board renderer is TypeScript in the agent package; bundle it to load it here.
	const renderer = path.join( temp, 'design-board.mjs' );
	await build( {
		entryPoints: [ DESIGN_BOARD ],
		outfile: renderer,
		bundle: true,
		platform: 'node',
		format: 'esm',
		// Its YAML parser is CommonJS and requires Node built-ins.
		banner: {
			js: "import { createRequire } from 'node:module'; const require = createRequire( import.meta.url );",
		},
		logLevel: 'warning',
	} );
	const { renderDesignBoard } = await import( pathToFileURL( renderer ).href );

	const page = await browser.newPage( { viewport: VIEWPORT } );
	for ( const look of await readJson( path.join( LOOKS_DIR, 'looks.json' ) ) ) {
		const photo = path.join( PHOTOS_DIR, `${ look.image }.jpg` );
		if ( ! existsSync( photo ) ) {
			throw new Error( `${ look.label }: no photo ${ photo }. Run npm run demo-site:build first.` );
		}
		const design = await readFile( path.join( LOOKS_DIR, look.design ), 'utf8' );
		const html = path.join( temp, `${ look.file }.html` );
		await writeFile( html, `\uFEFF${ renderDesignBoard( design, pathToFileURL( photo ).href ) }` );
		await page.goto( pathToFileURL( html ).href, { waitUntil: 'networkidle' } );
		await page.evaluate( () => document.fonts.ready );
		await page.screenshot( { path: path.join( LOOKS_DIR, look.file ), type: 'jpeg', quality: 85 } );
		console.log( `  ${ look.file }  ${ look.label }` );
	}
} finally {
	await browser.close();
	await rm( temp, { recursive: true, force: true } );
}
