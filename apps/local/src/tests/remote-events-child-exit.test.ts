import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startRemoteTestServer } from './utils/remote-test-utils';

const cliBinary = path.join( import.meta.dirname, 'fixtures', 'fake-cli.mjs' );

let pidDir: string;
let pidFile: string;

beforeAll( () => {
	pidDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-pids-' ) );
	pidFile = path.join( pidDir, 'events' );
	process.env.FAKE_CLI_PID_FILE = pidFile;
	process.env.FAKE_CLI_SLOW_EXIT = '1';
} );

afterAll( () => {
	delete process.env.FAKE_CLI_PID_FILE;
	delete process.env.FAKE_CLI_SLOW_EXIT;
	rmSync( pidDir, { recursive: true, force: true } );
} );

const isAlive = ( pid: number ) => {
	try {
		process.kill( pid, 0 );
		return true;
	} catch {
		return false;
	}
};

const recordedPids = () =>
	existsSync( pidFile )
		? readFileSync( pidFile, 'utf8' ).split( '\n' ).filter( Boolean ).map( Number )
		: [];

// The `_events` child holds the remote listener's socket until it exits. A
// server started next, as Automatic does after a connection fails, can only
// take the socket once the old child is gone.
describe( "the server's events child", () => {
	it( 'has exited when close() returns', async () => {
		const test = await startRemoteTestServer( { cliBinary } );
		await vi.waitFor( () => expect( recordedPids() ).toHaveLength( 1 ), { timeout: 5000 } );
		const [ pid ] = recordedPids();

		await test.stop();

		expect( isAlive( pid ) ).toBe( false );
	}, 15_000 );
} );
