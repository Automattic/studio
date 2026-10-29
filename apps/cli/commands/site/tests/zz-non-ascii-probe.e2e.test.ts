/**
 * @vitest-environment node
 *
 * Probe, do not merge: does a Windows config directory with a non-ASCII name stop
 * PHP from loading its extension DLLs? Fails on purpose to surface the results.
 */
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { cleanupCliEnv, runCli, setupCliEnv, type CliEnv } from './helpers/cli-e2e';

const NAMES = [ 'ascii', 'José', 'Данил', '张伟' ];

function envUnder( name: string ): CliEnv {
	const env = setupCliEnv();
	const root = path.join( os.tmpdir(), `${ name }-${ randomUUID().slice( 0, 8 ) }` );
	fs.renameSync( env.root, root );
	const configDir = path.join( root, 'config' );
	return {
		...env,
		root,
		configDir,
		sitesDir: path.join( root, 'sites' ),
		cliConfigPath: path.join( configDir, 'cli.json' ),
	};
}

describe.skipIf( process.platform !== 'win32' )( 'probe: non-ASCII config dir', () => {
	it( 'reports start results', { tags: [ 'e2e' ], timeout: 900_000 }, async () => {
		const report: Record< string, unknown > = {
			ansiCodePage: execSync( 'powershell -NoProfile -Command "[System.Text.Encoding]::Default.CodePage"' )
				.toString()
				.trim(),
		};
		for ( const name of NAMES ) {
			const env = envUnder( name );
			const sitePath = path.join( env.sitesDir, 'probe-site' );
			const startedAt = Date.now();
			try {
				const create = await runCli(
					[ 'site', 'create', '--name', 'Probe', '--path', sitePath, '--wp', 'latest', '--no-start', '--skip-browser', '--skip-log-details' ],
					env
				);
				const start = await runCli(
					[ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
					env
				);
				const output = `${ start.stdout }\n${ start.stderr }`;
				report[ name ] = {
					create: create.code,
					start: start.code,
					ms: Date.now() - startedAt,
					unableToLoad: ( output.match( /Unable to load dynamic library '([^']+)'/g ) ?? [] ).length,
					firstError: start.code === 0 ? null : output.replace( /\s+/g, ' ' ).replace( /Users\\[^\\]+/g, 'Users\\<home>' ).slice( -700 ),
				};
			} finally {
				await runCli( [ 'site', 'stop', '--all' ], env );
				cleanupCliEnv( env );
			}
		}
		expect.fail( `PROBE ${ JSON.stringify( report ) }` );
	} );
} );
