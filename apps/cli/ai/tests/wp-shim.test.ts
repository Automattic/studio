import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	agentShell,
	ensureStudioShimDirectory,
	getStudioShims,
} from '@studio/agent/node/runtime/studio-wp-shim';
import { serveWpCli } from '@studio/agent/node/runtime/wp-cli-server';
import { describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';

const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

// `wp` in the agent's shell, served by the agent's process: Studio's CLI is
// not there to start, so each command runs only as the server answers it.
describe.runIf( WORDPRESS && process.platform !== 'win32' )( 'wp in the agent shell', () => {
	const shell = async () => {
		const site = liveSite( WORDPRESS! );
		const root = fs.mkdtempSync( path.join( os.tmpdir(), 'wp-shim-' ) );
		const directory = ensureStudioShimDirectory(
			getStudioShims( process.execPath, path.join( root, 'no-cli.mjs' ) ),
			path.join( root, 'agent-bin' )
		);
		const { env } = agentShell(
			directory,
			await serveWpCli( liveHost( site ) )
		)( {
			command: '',
			cwd: site.path,
			env: { PATH: '/usr/bin:/bin' },
		} );
		// Not spawnSync: the server answers from this process.
		return ( command: string, input = '' ) =>
			new Promise< { stdout: string; stderr: string; status: number | null } >( ( resolve ) => {
				const child = spawn( '/bin/sh', [ '-c', command ], { cwd: site.path, env } );
				let stdout = '';
				let stderr = '';
				child.stdout.on( 'data', ( chunk ) => ( stdout += chunk ) );
				child.stderr.on( 'data', ( chunk ) => ( stderr += chunk ) );
				child.on( 'close', ( status ) => resolve( { stdout, stderr, status } ) );
				child.stdin.end( input );
			} );
	};

	it( 'runs WP-CLI on the site, with stdin and exit code, as studio wp does', async () => {
		const run = await shell();

		expect( await run( 'wp option get blogname' ) ).toMatchObject( { status: 0 } );
		expect(
			await run( 'studio wp eval-file -', '<?php echo get_option( "siteurl" ) ? 6 * 7 : 0;' )
		).toMatchObject( {
			stdout: '42',
			status: 0,
		} );
		expect( ( await run( 'wp post get 999999 --field=ID' ) ).status ).toBe( 1 );
		// The site at --path, from any folder, as studio wp reads it.
		expect( await run( `cd / && wp --path=${ WORDPRESS } eval 'echo ABSPATH;'` ) ).toMatchObject( {
			stdout: `${ WORDPRESS }/`,
			status: 0,
		} );
		// The shell's environment, less what Windows could not spawn PHP with.
		expect(
			await run(
				`SMALL=kept BIG=$(printf '%9000s') wp eval 'echo getenv( "SMALL" ), " ", var_export( getenv( "BIG" ), true );'`
			)
		).toMatchObject( { stdout: 'kept false', status: 0 } );
		expect( await run( 'wp shell' ) ).toMatchObject( {
			stderr: expect.stringContaining( 'does not support the WP-CLI `shell` command' ),
			status: 1,
		} );
	}, 60000 );
} );
