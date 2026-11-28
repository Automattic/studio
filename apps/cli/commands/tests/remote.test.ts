import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	createPairingCode,
	listRemoteDevices,
	readRemoteAccess,
	redeemPairingCode,
	setRemoteServerInfo,
} from '@studio/common/lib/remote-access';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockReportError, mockReportResult, mockReportSuccess } from 'cli/tests/test-utils';
import { runListCommand, runRevokeCommand } from '../remote/devices';
import { runCommand as runPairCommand } from '../remote/pair';

vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
		reportResult = mockReportResult;
	},
	LoggerError: class LoggerError extends Error {},
} ) );

let configDir: string;

beforeEach( () => {
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-cli-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
} );

afterEach( () => {
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

async function pairPhone( name = 'Test phone' ): Promise< string > {
	const { code } = await createPairingCode();
	const paired = await redeemPairingCode( { code, deviceName: name, platform: 'ios' } );
	return paired!.deviceId;
}

// The process id of a process that has already exited.
function deadPid(): number {
	return spawnSync( process.execPath, [ '-e', '' ] ).pid;
}

const loggedText = () => vi.mocked( console.log ).mock.calls.flat().join( '\n' );
const reportedErrors = () =>
	mockReportError.mock.calls.map( ( [ error ] ) => ( error as Error ).message );

describe( 'CLI: studio remote pair', () => {
	it( 'says remote mode is not running when there is no server record', async () => {
		await runPairCommand();

		expect( reportedErrors() ).toEqual( [ expect.stringContaining( 'not running' ) ] );
		expect( ( await readRemoteAccess() ).pairingCodes ).toEqual( [] );
	} );

	it( 'says remote mode is not running when the recorded process is gone', async () => {
		await setRemoteServerInfo( {
			url: 'http://127.0.0.1:8082',
			pid: deadPid(),
			connection: 'local',
		} );

		await runPairCommand();

		expect( reportedErrors() ).toEqual( [ expect.stringContaining( 'not running' ) ] );
		expect( ( await readRemoteAccess() ).pairingCodes ).toEqual( [] );
	} );

	it( 'prints one new code for the recorded address when the server is running', async () => {
		await setRemoteServerInfo( {
			url: 'http://127.0.0.1:8791',
			pid: process.pid,
			connection: 'local',
		} );

		await runPairCommand();

		expect( mockReportError ).not.toHaveBeenCalled();
		expect( loggedText() ).toContain( 'Address: http://127.0.0.1:8791' );
		expect( ( await readRemoteAccess() ).pairingCodes ).toHaveLength( 1 );
	} );
} );

describe( 'CLI: studio remote devices list', () => {
	it( 'prints the devices as JSON without their token hash', async () => {
		await pairPhone();

		await runListCommand( 'json' );

		const printed = JSON.parse( String( vi.mocked( console.log ).mock.calls[ 0 ][ 0 ] ) );
		expect( printed ).toHaveLength( 1 );
		expect( printed[ 0 ] ).toMatchObject( { name: 'Test phone', platform: 'ios' } );
		expect( printed[ 0 ] ).not.toHaveProperty( 'tokenHash' );
		expect( mockReportResult ).toHaveBeenCalledWith( printed );
		expect( mockReportError ).not.toHaveBeenCalled();
	} );

	it( 'prints an empty array when no device is paired', async () => {
		await runListCommand( 'json' );

		expect( vi.mocked( console.log ).mock.calls[ 0 ][ 0 ] ).toBe( '[]' );
		expect( mockReportError ).not.toHaveBeenCalled();
	} );
} );

describe( 'CLI: studio remote devices revoke', () => {
	it( 'reports an unknown device ID and keeps the paired ones', async () => {
		await pairPhone();

		await runRevokeCommand( 'no-such-device' );

		expect( reportedErrors() ).toEqual( [ expect.stringContaining( 'No paired device' ) ] );
		expect( await listRemoteDevices() ).toHaveLength( 1 );
	} );

	it( 'removes the device it names and no other', async () => {
		const first = await pairPhone( 'First' );
		await pairPhone( 'Second' );

		await runRevokeCommand( first );

		expect( mockReportError ).not.toHaveBeenCalled();
		expect( mockReportSuccess ).toHaveBeenCalledOnce();
		expect( ( await listRemoteDevices() ).map( ( device ) => device.name ) ).toEqual( [
			'Second',
		] );
	} );
} );
