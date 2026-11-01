/**
 * Captures the docs screenshots with the Studio capture harness
 * (tools/capture-harness): the scripts in `screenshots/shots/` on its
 * Wren & Barley scene, in the docs look, into `screenshots/images/`. After a
 * full run it rewrites `screenshots/images/index.md`, the list of shots and
 * the uploads they replace.
 *
 *   npm run screenshots -- [--suite <name,…>] [--only <name,…>] [--check] [--keep-profile]
 *
 * Other options are passed to `studio-capture capture`; see its README.
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/common.mjs';

const UPLOADS_URL = 'https://developer.wordpress.com/wp-content/uploads/';
const HARNESS = path.resolve( ROOT, '../../tools/capture-harness/cli.ts' );
const IMAGES_DIR = path.join( ROOT, 'screenshots', 'images' );

function formatIndex( { shots, manual, studioVersion } ) {
	const cell = ( list = [] ) => list.map( ( item ) => `\`${ item }\`` ).join( '<br>' ) || '—';
	const failed = shots.filter( ( shot ) => shot.status === 'failed' );
	const lines = [
		`# Studio screenshots`,
		'',
		`Captured from Studio ${ studioVersion } by \`npm run screenshots\`, signed out except the signed-in suites (\`signedIn\` in their JSON), which show a WordPress.com account with its email masked.`,
		`Upload to WordPress.com; a file named \`<name>.webp\` becomes \`${ UPLOADS_URL }YYYY/MM/<name>.webp\`.`,
		`Shots with annotations also have a \`<name>-annotated.webp\`.`,
		'',
		'| File | Suite | Shows | Used on | Replaces |',
		'| --- | --- | --- | --- | --- |',
		...shots.map(
			( shot ) =>
				`| \`${ shot.name }.webp\` | ${ shot.script } | ${ shot.description } | ${ cell(
					shot.pages
				) } | ${ cell( shot.replaces ) } |`
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
					`| ${ shot.description } | ${ cell( shot.pages ) } | ${ cell( shot.replaces ) } |`
			)
		);
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
		'--look',
		'docs',
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
	await writeFile( path.join( IMAGES_DIR, 'index.md' ), formatIndex( result ) );
}
process.exit( code ?? 1 );
