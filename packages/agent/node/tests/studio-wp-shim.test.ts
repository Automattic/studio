import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	agentShell,
	ensureStudioShimDirectory,
	getStudioShims,
} from '@studio/agent/node/runtime/studio-wp-shim';

describe.skipIf( process.platform === 'win32' )( 'studio wp shim', () => {
	let root: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), "studio-wp-shim-it's-" ) );
	} );

	afterEach( () => {
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it.each( [
		{
			command: `wp post create --post_title="Ember & Oak" page.html`,
			args: [
				'wp',
				'post',
				'create',
				'--post_title=Ember & Oak',
				'page.html',
				'--avoid-telemetry',
			],
		},
		{
			command: `studio wp post create --porcelain`,
			args: [ 'wp', 'post', 'create', '--porcelain', '--avoid-telemetry' ],
		},
		{ command: 'studio site list', args: [ 'site', 'list', '--avoid-telemetry' ] },
	] )(
		'makes `$command` in the Bash tool run the Studio running the agent',
		( { command, args } ) => {
			// Stands in for the CLI entry: prints the arguments it receives.
			const cliPath = path.join( root, 'main.mjs' );
			fs.writeFileSync( cliPath, 'console.log( JSON.stringify( process.argv.slice( 2 ) ) );' );
			const directory = ensureStudioShimDirectory(
				getStudioShims( process.execPath, cliPath ),
				path.join( root, 'agent-bin' )
			);
			const { env } = agentShell( directory )( {
				command: '',
				cwd: root,
				env: { PATH: '/usr/bin:/bin' },
			} );

			const output = execFileSync( '/bin/sh', [ '-c', command ], { env, encoding: 'utf8' } );

			expect( JSON.parse( output ) ).toEqual( args );
		}
	);

	it( 'passes stdin, inline environment variables and exit code through', () => {
		// Stands in for the CLI entry: echoes stdin and an environment variable, then exits 3.
		const cliPath = path.join( root, 'main.mjs' );
		fs.writeFileSync(
			cliPath,
			[
				"import fs from 'fs';",
				'process.stdout.write( `${ process.env.TAXONOMIST_MODE }:${ fs.readFileSync( 0, "utf8" ) }` );',
				'process.exit( 3 );',
			].join( '\n' )
		);
		const directory = ensureStudioShimDirectory(
			getStudioShims( process.execPath, cliPath ),
			path.join( root, 'agent-bin' )
		);
		const { env } = agentShell( directory )( {
			command: '',
			cwd: root,
			env: { PATH: '/usr/bin:/bin' },
		} );

		const result = spawnSync(
			'/bin/sh',
			[ '-c', 'TAXONOMIST_MODE=apply wp eval-file taxonomist.php' ],
			{ env, input: 'post content', encoding: 'utf8' }
		);

		expect( result.stdout ).toBe( 'apply:post content' );
		expect( result.status ).toBe( 3 );
	} );

	it( 'reuses the shim directory for the same script', () => {
		const shims = getStudioShims( '/node', '/cli/main.mjs' );
		const agentBin = path.join( root, 'agent-bin' );
		expect( ensureStudioShimDirectory( shims, agentBin ) ).toBe(
			ensureStudioShimDirectory( shims, agentBin )
		);
	} );

	it.each< { env: Record< string, string >; preferOffline: string } >( [
		{ env: {}, preferOffline: 'true' },
		{ env: { NPM_CONFIG_PREFER_ONLINE: 'true' }, preferOffline: 'false' },
		{ env: { npm_config_prefer_offline: 'false' }, preferOffline: 'false' },
	] )(
		'npm in the agent shell prefers its cache unless told otherwise: $env',
		( { env, preferOffline } ) => {
			const result = agentShell( path.join( root, 'agent-bin' ) )( {
				command: '',
				cwd: root,
				env: { PATH: process.env.PATH ?? '', HOME: root, ...env },
			} );

			const output = execFileSync( 'npm', [ 'config', 'get', 'prefer-offline' ], {
				cwd: root,
				env: result.env,
				encoding: 'utf8',
			} );

			expect( output.trim() ).toBe( preferOffline );
		}
	);
} );
