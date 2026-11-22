/**
 * Captures the docs screenshots with the Studio capture harness
 * (tools/capture-harness): the scripts in `screenshots/shots/` on its
 * Moire scene (Rich's Moire Blueprint), in the docs look, into
 * `screenshots/images/`. Only shots a page in `docs/` shows are saved there
 * (the other shots' steps still run when later shots need them); with
 * `--extras`, the shots no page shows are captured into the untracked
 * `screenshots/extras/` instead, for blog posts, marketing and the like. The first run on a machine bakes the scene's site
 * from the Blueprint (`studio-capture bake --scene moire`). After a
 * full run it rewrites `screenshots/images/index.md`, the list of shots and
 * the uploads they replace, keeping its hand-maintained Kept by hand section.
 *
 *   npm run screenshots -- [--extras] [--suite <name,…>] [--only <name,…>] [--check] [--keep-profile]
 *
 * An image is rewritten only when at least MIN_CHANGE percent of its pixels
 * changed, so a restyled icon or border doesn't add every image to a pull
 * request; the run reports the rest as `minor`. Name a shot with `--only` to
 * write it whatever changed, or pass `--min-change <percent>` yourself.
 *
 * Other options are passed to `studio-capture capture`; see its README.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve( import.meta.dirname, '..' );
const UPLOADS_URL = 'https://developer.wordpress.com/wp-content/uploads/';
const HARNESS = path.resolve( ROOT, '../../tools/capture-harness/cli.ts' );
const IMAGES_DIR = path.join( ROOT, 'screenshots', 'images' );
const EXTRAS_DIR = path.join( ROOT, 'screenshots', 'extras' );
const SHOTS_DIR = path.join( ROOT, 'screenshots', 'shots' );
const INDEX_FILE = path.join( IMAGES_DIR, 'index.md' );
const DOCS_DIR = path.join( ROOT, 'docs', 'developer-tools', 'studio' );
const SCENE = 'moire';
const MIN_CHANGE = 1;

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

// Every image file name a docs page shows.
function imagesOnPages() {
	const shown = new Set();
	const walk = ( dir ) => {
		for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
			const file = path.join( dir, entry.name );
			if ( entry.isDirectory() ) {
				walk( file );
			} else if ( entry.name.endsWith( '.md' ) ) {
				for ( const [ , name ] of readFileSync( file, 'utf8' ).matchAll(
					/screenshots\/images\/([\w.-]+)/g
				) ) {
					shown.add( name );
				}
			}
		}
	};
	walk( path.join( ROOT, 'docs' ) );
	return shown;
}

// The shots of every script, and whether a page shows one of their images.
function listShots( shown ) {
	return readdirSync( SHOTS_DIR )
		.filter( ( file ) => file.endsWith( '.json' ) )
		.flatMap( ( file ) => {
			const script = JSON.parse( readFileSync( path.join( SHOTS_DIR, file ), 'utf8' ) );
			return script.manual
				? []
				: script.shots.map( ( shot ) => ( {
						name: shot.name,
						script: script.name,
						description: shot.description,
						onPage: [ `${ shot.name }.webp`, `${ shot.name }-annotated.webp` ].some( ( image ) =>
							shown.has( image )
						),
				  } ) );
		} );
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

function formatIndex( { shots, manual, studioVersion }, extras ) {
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
	if ( extras.length ) {
		lines.push(
			'',
			'## Extras',
			'',
			'No docs page shows these, so their images are not kept here. Capture them into `screenshots/extras/` with `npm run screenshots -- --extras` (add `--only <name,…>` for some).',
			'',
			'| Shot | Suite | Shows |',
			'| --- | --- | --- |',
			...extras.map(
				( shot ) => `| \`${ shot.name }\` | ${ shot.script } | ${ shot.description } |`
			)
		);
	}
	const keptByHand = readKeptByHand();
	if ( keptByHand ) {
		lines.push( '', keptByHand );
	}
	return lines.join( '\n' ) + '\n';
}

const given = process.argv.slice( 2 );
const extrasMode = given.includes( '--extras' );
const args = given.filter( ( arg ) => arg !== '--extras' );
const named = args.some( ( arg ) => /^--only\b/.test( arg ) );
const chosen = named || args.some( ( arg ) => /^--min-change\b/.test( arg ) );
const shown = imagesOnPages();
const shots = listShots( shown );
const extras = shots.filter( ( shot ) => ! shot.onPage );
const selection = ( extrasMode ? extras : shots.filter( ( shot ) => shot.onPage ) ).map(
	( shot ) => shot.name
);
const child = spawn(
	process.execPath,
	[
		'--experimental-strip-types',
		HARNESS,
		'capture',
		SHOTS_DIR,
		'--out',
		extrasMode ? EXTRAS_DIR : IMAGES_DIR,
		'--json',
		// Extras are new files each time; the docs keep an image a restyle barely touched.
		...( chosen || extrasMode ? [] : [ '--min-change', String( MIN_CHANGE ) ] ),
		...( named ? [] : [ '--only', selection.join( ',' ) ] ),
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

if ( ! extrasMode && ! named && ! args.includes( '--check' ) ) {
	// A docs shot can make a file no page shows (its plain or annotated copy); it isn't kept.
	for ( const file of ( result.shots ?? [] ).flatMap( ( shot ) => shot.files ?? [] ) ) {
		if ( file.status === 'new' && ! shown.has( path.basename( file.file ) ) ) {
			await rm( file.file, { force: true } );
			console.error( `  dropped   ${ path.basename( file.file ) } (no page shows it)` );
		}
	}
}

// The docs site imports the folder as is, so every image a page links must be in it.
const missing = [ ...shown ].filter( ( name ) => ! existsSync( path.join( IMAGES_DIR, name ) ) );
if ( missing.length && ! extrasMode ) {
	console.error(
		`\nPages link images that aren't in screenshots/images/: ${ missing.join( ', ' ) }`
	);
}

// The index describes a whole docs run; a partial one would misreport the rest.
const partial = extrasMode || args.some( ( arg ) => /^--(suite|only|check)\b/.test( arg ) );
if ( ! partial && result.shots ) {
	await writeFile( INDEX_FILE, formatIndex( result, extras ) );
}
process.exit( code ?? 1 );
