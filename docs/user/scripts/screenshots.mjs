/**
 * Captures the docs screenshots with the Studio capture harness
 * (tools/capture-harness): the scripts in `screenshots/shots/` on its
 * Moire scene (Rich's Moire Blueprint), in the docs look, into
 * `screenshots/images/`. The first run on a machine bakes the scene's site
 * from the Blueprint (`studio-capture bake --scene moire`). After a
 * full run it rewrites `screenshots/images/index.md`, the list of shots and
 * the uploads they replace, keeping its hand-maintained Kept by hand section.
 *
 *   npm run screenshots -- [--suite <name,…>] [--only <name,…>] [--check] [--keep-profile]
 *
 * Other options are passed to `studio-capture capture`; see its README.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve( import.meta.dirname, '..' );
const UPLOADS_URL = 'https://developer.wordpress.com/wp-content/uploads/';
const HARNESS = path.resolve( ROOT, '../../tools/capture-harness/cli.ts' );
const IMAGES_DIR = path.join( ROOT, 'screenshots', 'images' );
const INDEX_FILE = path.join( IMAGES_DIR, 'index.md' );
const DOCS_DIR = path.join( ROOT, 'docs', 'developer-tools', 'studio' );
const SCENE = 'moire';

// Build the scene's site from its Blueprint once per machine; captures then import the backup.
if ( ! existsSync( path.resolve( HARNESS, '..', 'scenes', SCENE, '.baked', 'scene.json' ) ) ) {
	const bake = spawnSync(
		process.execPath,
		[ '--experimental-strip-types', HARNESS, 'bake', '--scene', SCENE ],
		{ stdio: 'inherit' }
	);
	if ( bake.status !== 0 ) {
		process.exit( bake.status ?? 1 );
	}
}

// A shot's `pages` can outlive its use: a page may have dropped the image while the shot stays.
function pagesShowing( shot ) {
	const files = [ `/${ shot.name }.webp`, `/${ shot.name }-annotated.webp` ];
	return ( shot.meta?.pages ?? [] ).filter( ( page ) => {
		const file = path.join( DOCS_DIR, page );
		if ( ! existsSync( file ) ) {
			return false;
		}
		const content = readFileSync( file, 'utf8' );
		return files.some( ( name ) => content.includes( name ) );
	} );
}

// No suite captures these images, so the run can't rebuild their section.
function readKeptByHand() {
	if ( ! existsSync( INDEX_FILE ) ) {
		return '';
	}
	const index = readFileSync( INDEX_FILE, 'utf8' );
	const start = index.indexOf( '## Kept by hand' );
	return start === -1 ? '' : index.slice( start ).trimEnd();
}

function formatIndex( { shots, manual, studioVersion } ) {
	const cell = ( list = [] ) => list.map( ( item ) => `\`${ item }\`` ).join( '<br>' ) || '—';
	const failed = shots.filter( ( shot ) => shot.status === 'failed' );
	const lines = [
		`# Studio screenshots`,
		'',
		`Captured from Studio ${ studioVersion } by \`npm run screenshots\`, signed out except the signed-in suites (\`signedIn\` in their JSON), which sign in as a made-up demo person.`,
		`Upload to WordPress.com; a file named \`<name>.webp\` becomes \`${ UPLOADS_URL }YYYY/MM/<name>.webp\`.`,
		`Shots with annotations also have a \`<name>-annotated.webp\`.`,
		'',
		'| File | Suite | Shows | Used on | Replaces |',
		'| --- | --- | --- | --- | --- |',
		...shots.map(
			( shot ) =>
				`| \`${ shot.name }.webp\` | ${ shot.script } | ${ shot.description } | ${ cell(
					pagesShowing( shot )
				) } | ${ cell( shot.meta?.replaces ) } |`
		),
	];
	if ( failed.length ) {
		lines.push(
			'',
			'## Failed in the last run',
			'',
			...failed.map( ( shot ) => `- \`${ shot.name }\` — ${ shot.error }` )
		);
	}
	if ( manual.length ) {
		lines.push(
			'',
			'## Capture manually',
			'',
			'These need a WordPress.com login, a connected live site, or Studio Code output.',
			'',
			'| Shows | Used on | Replaces |',
			'| --- | --- | --- |',
			...manual.map(
				( shot ) =>
					`| ${ shot.description } | ${ cell( shot.meta?.pages ) } | ${ cell(
						shot.meta?.replaces
					) } |`
			)
		);
	}
	const keptByHand = readKeptByHand();
	if ( keptByHand ) {
		lines.push( '', keptByHand );
	}
	return lines.join( '\n' ) + '\n';
}

const args = process.argv.slice( 2 );
const child = spawn(
	process.execPath,
	[
		'--experimental-strip-types',
		HARNESS,
		'capture',
		path.join( ROOT, 'screenshots', 'shots' ),
		'--out',
		IMAGES_DIR,
		'--json',
		...args,
	],
	{ stdio: [ 'inherit', 'pipe', 'inherit' ] }
);
let stdout = '';
child.stdout.on( 'data', ( chunk ) => ( stdout += chunk ) );
const code = await new Promise( ( resolve ) => child.on( 'close', resolve ) );
const result = JSON.parse( stdout || '{}' );
if ( result.error ) {
	console.error( result.error );
	process.exit( 1 );
}

// The index describes a whole run; a partial one would misreport the rest.
const partial = args.some( ( arg ) => /^--(suite|only|check)\b/.test( arg ) );
if ( ! partial && result.shots ) {
	await writeFile( INDEX_FILE, formatIndex( result ) );
}
process.exit( code ?? 1 );
