/**
 * Renders the design looks Studio Code offers in a scene's design picker shot
 * (`<scene>/design-looks/`): each look in `looks.json` is a DESIGN.md draft
 * and a photo, drawn as a design board by the agent's own `renderDesignBoard`,
 * the way `present_design_options` does, and saved as `<file>` next to it. The
 * shot plays them back as a pending question (see `agent-turns/` and the
 * `stubAgentRuns` / `playAgentTurn` helpers), so no model runs. Run it after
 * editing a look:
 *
 *   npm -w @studio/capture-harness run moire:looks
 *
 * A look's `image` is a file inside one of the scene's zips, as `<zip>:<file>`
 * (`blueprint/uploads.zip:2026/10/wool.jpg`, so a photo the site already ships
 * isn't committed twice), or the name of a photo in the scene's `source/.cache/`.
 * The boards load their fonts from Google Fonts.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { extractZip } from '../../../packages/common/lib/extract-zip.ts';
import { REPO_ROOT, readJson } from './paths.ts';

const SCENE_DIR = path.resolve(
	process.argv[ 2 ] ?? path.join( import.meta.dirname, '../scenes/moire' )
);
const LOOKS_DIR = path.join( SCENE_DIR, 'design-looks' );
const PHOTOS_DIR = path.join( SCENE_DIR, 'source', '.cache' );
const DESIGN_BOARD = path.join( REPO_ROOT, 'packages/agent/node/design-board.ts' );

interface DesignLook {
	label: string;
	image: string;
	design: string;
	file: string;
}
// `present_design_options` renders each look in this frame.
const VIEWPORT = { width: 1200, height: 900 };

const temp = await mkdtemp( path.join( tmpdir(), 'studio-design-looks-' ) );
const unzipped = new Map< string, string >();

/** The photo a look names: a file inside one of the scene's zips, or one of its cached photos. */
async function photoFor( image: string ) {
	const [ zip, file ] = image.split( ':' );
	if ( ! file ) {
		return path.join( PHOTOS_DIR, `${ image }.jpg` );
	}
	let dir = unzipped.get( zip );
	if ( ! dir ) {
		dir = path.join( temp, `zip-${ unzipped.size }` );
		await extractZip( path.join( SCENE_DIR, zip ), dir );
		unzipped.set( zip, dir );
	}
	return path.join( dir, file );
}
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
	const { renderDesignBoard } = ( await import( pathToFileURL( renderer ).href ) ) as {
		renderDesignBoard: ( design: string, photo: string ) => string;
	};

	const page = await browser.newPage( { viewport: VIEWPORT } );
	for ( const look of await readJson< DesignLook[] >( path.join( LOOKS_DIR, 'looks.json' ) ) ) {
		const photo = await photoFor( look.image );
		if ( ! existsSync( photo ) ) {
			throw new Error( `${ look.label }: no photo ${ photo }. Run the scene's build first.` );
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
