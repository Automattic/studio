import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalServer } from '../index';
import {
	baseServerOptions,
	request,
	startRemoteTestServer,
	type TestRemoteServer,
} from './utils/remote-test-utils';

const cliBinary = path.join( import.meta.dirname, 'fixtures', 'fake-cli.mjs' );

let test: TestRemoteServer;
let pidDir: string;
let pidFile: string;

beforeAll( async () => {
	pidDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-pids-' ) );
	pidFile = path.join( pidDir, 'events' );
	// Every `_events` child of this file's servers records its process id here.
	process.env.FAKE_CLI_PID_FILE = pidFile;
	test = await startRemoteTestServer( { cliBinary } );
} );

afterAll( async () => {
	delete process.env.FAKE_CLI_PID_FILE;
	await test.stop();
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

describe( 'a server that cannot bind its port', () => {
	it( 'rejects with the bind error, leaves no child behind and spares the first server', async () => {
		await expect(
			startLocalServer( {
				...baseServerOptions,
				cliBinary,
				host: '127.0.0.1',
				port: test.server.port,
				remote: { label: 'Test Mac', studioVersion: '0.0.0-test' },
			} )
		).rejects.toMatchObject( { code: 'EADDRINUSE' } );

		// Give a child that was forked but not yet killed time to show itself.
		await new Promise( ( resolve ) => setTimeout( resolve, 1000 ) );
		const [ firstPid, ...others ] = recordedPids();
		expect( isAlive( firstPid ) ).toBe( true );
		expect( others.filter( isAlive ) ).toEqual( [] );

		const reply = await request( test.server.port, { path: '/.well-known/studio/remote' } );
		expect( reply.status ).toBe( 200 );
	} );
} );
