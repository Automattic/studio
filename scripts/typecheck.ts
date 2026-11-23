/**
 * Typechecks every workspace that has a `typecheck` script, plus `scripts/`, with TypeScript 7.
 * The projects run in parallel; the output of each failing one is printed in full.
 *
 * TypeScript 6 stays installed as `typescript` for the tools that use its JavaScript API
 * (typescript-eslint, knip, Vite plugins); TypeScript 7 is installed as `typescript-7`.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify( execFile );
const root = path.resolve( import.meta.dirname, '..' );
const require = createRequire( import.meta.url );
const tsc = path.join( path.dirname( require.resolve( 'typescript-7/package.json' ) ), 'bin/tsc' );

const rootPackage = JSON.parse( fs.readFileSync( path.join( root, 'package.json' ), 'utf8' ) );
const workspaces: string[] = rootPackage.workspaces.flatMap( ( pattern: string ) => {
	const dir = pattern.replace( /\/\*$/, '' );
	return fs
		.readdirSync( path.join( root, dir ), { withFileTypes: true } )
		.filter( ( entry ) => entry.isDirectory() )
		.map( ( entry ) => `${ dir }/${ entry.name }` );
} );

const projects = [
	...workspaces.filter( ( dir ) => {
		const file = path.join( root, dir, 'package.json' );
		return (
			fs.existsSync( file ) && JSON.parse( fs.readFileSync( file, 'utf8' ) ).scripts?.typecheck
		);
	} ),
	'scripts',
];

async function main() {
	const results = await Promise.all(
		projects.map( async ( project ) => {
			const tsconfig = path.join( root, project, 'tsconfig.json' );
			try {
				await run( process.execPath, [ tsc, '-p', tsconfig, '--noEmit', '--pretty' ], {
					cwd: root,
					maxBuffer: 64 * 1024 * 1024,
				} );
				return { project, ok: true, output: '' };
			} catch ( error ) {
				const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
				return { project, ok: false, output: `${ stdout }${ stderr }` };
			}
		} )
	);

	const failed = results.filter( ( result ) => ! result.ok );
	for ( const { project, output } of failed ) {
		console.error( `\n✖ ${ project }\n${ output }` );
	}
	console.log(
		`${ results.length - failed.length }/${ results.length } projects typecheck with TypeScript 7`
	);
	process.exitCode = failed.length ? 1 : 0;
}

void main();
