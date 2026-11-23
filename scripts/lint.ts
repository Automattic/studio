/**
 * Runs the `lint` script of every workspace, plus ESLint on `scripts/`, in parallel, and prints
 * the output of each failing one in full. Arguments are passed to ESLint (e.g. `--fix`).
 *
 * The workspaces run as separate ESLint processes because one process with every TypeScript
 * project loaded runs out of memory. Typed linting holds up to ~4.5 GB per process, so the
 * number of processes at once follows the machine's memory as well as its cores.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve( import.meta.dirname, '..' );
const eslintArgs = process.argv.slice( 2 );
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const rootPackage = JSON.parse( fs.readFileSync( path.join( root, 'package.json' ), 'utf8' ) );
const workspaces: string[] = rootPackage.workspaces.flatMap( ( pattern: string ) => {
	const dir = pattern.replace( /\/\*$/, '' );
	return fs
		.readdirSync( path.join( root, dir ), { withFileTypes: true } )
		.filter( ( entry ) => entry.isDirectory() )
		.map( ( entry ) => `${ dir }/${ entry.name }` );
} );

type Task = { name: string; command: string; args: string[]; cwd: string };

const tasks: Task[] = [
	...workspaces
		.filter( ( dir ) => {
			const file = path.join( root, dir, 'package.json' );
			return fs.existsSync( file ) && JSON.parse( fs.readFileSync( file, 'utf8' ) ).scripts?.lint;
		} )
		.map( ( dir ) => ( {
			name: dir,
			command: npm,
			args: [ 'run', 'lint', '--silent', '--', ...eslintArgs ],
			cwd: path.join( root, dir ),
		} ) ),
	{ name: 'scripts', command: npx, args: [ 'eslint', 'scripts', ...eslintArgs ], cwd: root },
];

// Largest first, so the longest pass starts right away.
const trackedFiles = execFileSync( 'git', [ 'ls-files' ], { cwd: root, encoding: 'utf8' } ).split(
	'\n'
);
const size = ( task: Task ) =>
	trackedFiles.filter( ( file ) => file.startsWith( `${ task.name }/` ) ).length;
tasks.sort( ( a, b ) => size( b ) - size( a ) );

const GB = 1024 ** 3;
// In a container, `totalmem()` is the host's memory; `constrainedMemory()` is the container's limit.
const memory = Math.min( os.totalmem(), process.constrainedMemory() || Infinity );
const limit = Math.max(
	1,
	Math.min( os.availableParallelism(), Math.floor( memory / ( 4.5 * GB ) ), tasks.length )
);

function runTask( task: Task ): Promise< { name: string; ok: boolean; output: string } > {
	return new Promise( ( resolve ) => {
		let output = '';
		const child = spawn( task.command, task.args, {
			cwd: task.cwd,
			shell: process.platform === 'win32',
			env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0' },
		} );
		child.stdout.on( 'data', ( chunk ) => ( output += chunk ) );
		child.stderr.on( 'data', ( chunk ) => ( output += chunk ) );
		child.on( 'error', ( error ) =>
			resolve( { name: task.name, ok: false, output: String( error ) } )
		);
		child.on( 'close', ( code ) => resolve( { name: task.name, ok: code === 0, output } ) );
	} );
}

async function main() {
	const queue = [ ...tasks ];
	const results: Awaited< ReturnType< typeof runTask > >[] = [];
	await Promise.all(
		Array.from( { length: limit }, async () => {
			for ( let task = queue.shift(); task; task = queue.shift() ) {
				results.push( await runTask( task ) );
			}
		} )
	);

	const failed = results.filter( ( result ) => ! result.ok );
	for ( const { name, output } of failed ) {
		console.error( `\n✖ ${ name }\n${ output }` );
	}
	console.log( `${ results.length - failed.length }/${ results.length } lint passes clean` );
	process.exitCode = failed.length ? 1 : 0;
}

void main();
