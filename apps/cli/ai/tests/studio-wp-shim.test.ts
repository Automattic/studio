import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureStudioWpShimDirectory,
	prependToPath,
	startStudioWpBroker,
	STUDIO_WP_BROKER_ENV,
} from 'cli/ai/runtimes/pi/studio-wp-shim';
import { LoggerError } from 'cli/logger';

// Runs `command` the way the Bash tool does, and collects what it prints.
function runInShell(
	command: string,
	env: NodeJS.ProcessEnv,
	input = ''
): Promise< { stdout: string; stderr: string; code: number | null } > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( '/bin/sh', [ '-c', command ], { env } );
		let stdout = '';
		let stderr = '';
		child.stdout.on( 'data', ( chunk ) => ( stdout += chunk ) );
		child.stderr.on( 'data', ( chunk ) => ( stderr += chunk ) );
		child.on( 'error', reject );
		child.on( 'exit', ( code ) => resolve( { stdout, stderr, code } ) );
		child.stdin.end( input );
	} );
}

describe.skipIf( process.platform === 'win32' )( 'wp in the agent shell', () => {
	let root: string;
	let directory: string;
	// Stands in for PHP running WP-CLI: reports what it was started with, then exits 3.
	let fakePhp: string;
	const closers: Array< () => void > = [];

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), "studio-wp-shim-it's-" ) );
		// Stands in for the Studio CLI entry: prints the arguments it receives.
		const cliPath = path.join( root, 'main.mjs' );
		fs.writeFileSync( cliPath, 'console.log( JSON.stringify( process.argv.slice( 2 ) ) );' );
		directory = ensureStudioWpShimDirectory( process.execPath, cliPath, path.join( root, 'bin' ) );
		fakePhp = path.join( root, 'php.mjs' );
		fs.writeFileSync(
			fakePhp,
			`let stdin = '';
process.stdin.on( 'data', ( chunk ) => ( stdin += chunk ) );
process.stdin.on( 'end', () => {
	console.log( JSON.stringify( {
		args: process.argv.slice( 2 ),
		cwd: process.cwd(),
		stdin,
		taxonomist: process.env.TAXONOMIST_MODE,
		allowRoot: process.env.WP_CLI_ALLOW_ROOT,
	} ) );
	process.exit( 3 );
} );`
		);
	} );

	afterEach( () => {
		closers.splice( 0 ).forEach( ( close ) => close() );
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	function shellEnv( extra: NodeJS.ProcessEnv = {} ) {
		return prependToPath(
			directory,
			extra
		)( {
			command: '',
			cwd: root,
			env: { PATH: '/usr/bin:/bin' },
		} ).env;
	}

	it( 'runs the command line the broker prepares, with the shell stdin, env and exit code', async () => {
		const broker = startStudioWpBroker( async ( cwd, argv ) => ( {
			command: process.execPath,
			args: [ fakePhp, `--path=${ cwd }`, ...argv ],
			cwd: os.tmpdir(),
		} ) );
		closers.push( broker.close );

		const result = await runInShell(
			`cd '${ root.replace(
				/'/g,
				`'\\''`
			) }' && TAXONOMIST_MODE=apply wp post create --post_title="Ember & Oak" -`,
			shellEnv( { [ STUDIO_WP_BROKER_ENV ]: broker.address } ),
			'<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->'
		);

		expect( result.code ).toBe( 3 );
		expect( JSON.parse( result.stdout ) ).toEqual( {
			args: [
				`--path=${ fs.realpathSync( root ) }`,
				'post',
				'create',
				'--post_title=Ember & Oak',
				'-',
			],
			cwd: fs.realpathSync( os.tmpdir() ),
			stdin: '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->',
			taxonomist: 'apply',
			allowRoot: '1',
		} );
	} );

	it( 'reports why the broker could not prepare the command', async () => {
		const broker = startStudioWpBroker( async () => {
			throw new LoggerError( 'Could not find Studio site.' );
		} );
		closers.push( broker.close );

		const result = await runInShell(
			'wp option get siteurl',
			shellEnv( { [ STUDIO_WP_BROKER_ENV ]: broker.address } )
		);

		expect( result ).toEqual( { stdout: '', stderr: 'Could not find Studio site.\n', code: 1 } );
	} );

	it( 'runs `studio wp` when no broker answers', async () => {
		const result = await runInShell(
			'wp option get siteurl',
			shellEnv( { [ STUDIO_WP_BROKER_ENV ]: path.join( root, 'missing.sock' ) } )
		);

		expect( JSON.parse( result.stdout ) ).toEqual( [ 'wp', 'option', 'get', 'siteurl' ] );
		expect( result.code ).toBe( 0 );
	} );

	it( 'reuses the shim directory for the same Node and CLI', () => {
		const bin = path.join( root, 'bin' );
		expect(
			ensureStudioWpShimDirectory( process.execPath, path.join( root, 'main.mjs' ), bin )
		).toBe( directory );
	} );
} );
