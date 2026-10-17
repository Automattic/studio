import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureStudioWpShimDirectory,
	getStudioWpShimScript,
	prependToPath,
} from 'cli/ai/runtimes/pi/studio-wp-shim';

describe.skipIf( process.platform === 'win32' )( 'studio wp shim', () => {
	let root: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), "studio-wp-shim-it's-" ) );
	} );

	afterEach( () => {
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it( 'makes `wp` in the Bash tool run `studio wp` with the same arguments', () => {
		// Stands in for the CLI entry: prints the arguments it receives.
		const cliPath = path.join( root, 'main.mjs' );
		fs.writeFileSync( cliPath, 'console.log( JSON.stringify( process.argv.slice( 2 ) ) );' );
		const directory = ensureStudioWpShimDirectory(
			getStudioWpShimScript( process.execPath, cliPath ),
			path.join( root, 'agent-bin' )
		);
		const { env } = prependToPath( directory )( {
			command: '',
			cwd: root,
			env: { PATH: '/usr/bin:/bin' },
		} );

		const output = execFileSync(
			'/bin/sh',
			[ '-c', `wp post create --post_title="Ember & Oak" page.html` ],
			{ env, encoding: 'utf8' }
		);

		expect( JSON.parse( output ) ).toEqual( [
			'wp',
			'post',
			'create',
			'--post_title=Ember & Oak',
			'page.html',
		] );
	} );

	it( 'reuses the shim directory for the same script', () => {
		const script = getStudioWpShimScript( '/node', '/cli/main.mjs' );
		const agentBin = path.join( root, 'agent-bin' );
		expect( ensureStudioWpShimDirectory( script, agentBin ) ).toBe(
			ensureStudioWpShimDirectory( script, agentBin )
		);
	} );
} );
