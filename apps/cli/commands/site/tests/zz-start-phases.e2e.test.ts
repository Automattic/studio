/**
 * @vitest-environment node
 *
 * Probe, not for merging: logs CLI boot, create and start phase timings on each CI platform.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupCliEnv, cliE2ePrerequisitesMet, runCli, setupCliEnv, type CliEnv } from './helpers/cli-e2e';

async function timed( args: string[], env: CliEnv ) {
	const t0 = performance.now();
	const result = await runCli( args, env );
	return { ms: Math.round( performance.now() - t0 ), result };
}

describe.skipIf( ! cliE2ePrerequisitesMet() )( 'probe: start phases', () => {
	let env: CliEnv;
	beforeAll( () => {
		process.env.STUDIO_PHASE_PROBE = '1';
		env = setupCliEnv();
	} );
	afterAll( () => {
		delete process.env.STUDIO_PHASE_PROBE;
		cleanupCliEnv( env );
	} );

	it( 'logs timings', { tags: [ 'e2e' ], timeout: 600_000 }, async () => {
		const rows: string[] = [];
		for ( let i = 0; i < 5; i++ ) {
			rows.push( `version ${ ( await timed( [ '--version' ], env ) ).ms }` );
		}
		const sitePath = path.join( env.sitesDir, 'probe' );
		const create = await timed(
			[ 'site', 'create', '--name', 'Probe', '--path', sitePath, '--wp', 'latest', '--no-start', '--skip-browser', '--skip-log-details' ],
			env
		);
		expect( create.result.code, create.result.stderr ).toBe( 0 );
		rows.push( `create-no-start ${ create.ms }` );
		for ( let i = 0; i < 6; i++ ) {
			const start = await timed( [ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ], env );
			expect( start.result.code, start.result.stderr ).toBe( 0 );
			const probe = start.result.stderr.match( /\[phase-probe\] (.*)/ )?.[ 1 ];
			rows.push( `start${ i } wall ${ start.ms } ${ probe }` );
			const stop = await timed( [ 'site', 'stop', '--path', sitePath ], env );
			rows.push( `stop${ i } wall ${ stop.ms } ${ stop.result.stderr.match( /\[stop-probe\] (.*)/ )?.[ 1 ] }` );
		}
		const stopLog = path.join( os.tmpdir(), 'phase-probe-stop.log' );
		rows.push( fs.existsSync( stopLog ) ? fs.readFileSync( stopLog, 'utf8' ) : 'no child stop log' );
		expect.fail( `PHASE-PROBE ${ process.platform }\n${ rows.join( '\n' ) }` );
	} );
} );
