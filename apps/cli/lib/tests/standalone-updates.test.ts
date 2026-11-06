// @vitest-environment node
import * as childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { c as archive } from 'tar';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { confirm } from 'cli/lib/prompts';
import {
	getStandaloneInstallDir,
	setupStandaloneAutoUpdates,
	updateStandaloneCli,
} from 'cli/lib/standalone-updates';

vi.mock( 'cli/lib/prompts', () => ( { confirm: vi.fn() } ) );
vi.mock( 'node:child_process', async ( original ) => ( {
	...( await original< typeof import('node:child_process') >() ),
	spawn: vi.fn(),
} ) );

const nodeExecutable = process.execPath;
const originalArgv = process.argv;
const originalSend = process.send;
const terminals = [ process.stdin, process.stdout, process.stderr ];
const terminalDescriptors = terminals.map( ( stream ) =>
	Object.getOwnPropertyDescriptor( stream, 'isTTY' )
);
let root: string;
let installDirectory: string;
let versionsDirectory: string;
let configDirectory: string;

beforeEach( async () => {
	root = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-updates-' ) );
	installDirectory = path.join( root, 'cli-versions', 'custom-install' );
	versionsDirectory = path.join( installDirectory, 'cli-versions' );
	configDirectory = path.join( root, 'config' );
	await fs.mkdir( path.join( installDirectory, 'bin' ), { recursive: true } );
	await fs.mkdir( path.join( installDirectory, 'cli' ) );
	await fs.writeFile( path.join( installDirectory, 'cli', 'main.mjs' ), 'original runtime' );
	await fs.writeFile( path.join( installDirectory, 'cli', 'version' ), '1.0.0\n' );
	Object.defineProperty( process, 'execPath', {
		value: path.join( installDirectory, 'bin', 'node' ),
		configurable: true,
	} );
	process.send = undefined;
	process.argv = [ nodeExecutable, 'studio', 'list' ];
	terminals.forEach( ( stream ) =>
		Object.defineProperty( stream, 'isTTY', { value: false, configurable: true } )
	);
	vi.stubEnv( 'DEV_CONFIG_DIR', configDirectory );
	vi.stubEnv( 'STUDIO_CLI_DISABLE_AUTO_UPDATES', '' );
	vi.mocked( childProcess.spawn ).mockReset();
} );

afterEach( async () => {
	Object.defineProperty( process, 'execPath', { value: nodeExecutable, configurable: true } );
	process.argv = originalArgv;
	process.send = originalSend;
	process.exitCode = 0;
	terminals.forEach( ( stream, index ) => {
		const descriptor = terminalDescriptors[ index ];
		if ( descriptor ) {
			Object.defineProperty( stream, 'isTTY', descriptor );
		} else {
			Reflect.deleteProperty( stream, 'isTTY' );
		}
	} );
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await fs.rm( root, { recursive: true, force: true } );
} );

async function releaseArchive( version = '2.0.0' ) {
	const fixture = path.join( root, 'release' );
	await fs.mkdir( path.join( fixture, 'bin' ), { recursive: true } );
	await fs.mkdir( path.join( fixture, 'cli' ) );
	const node = path.join( fixture, 'bin', process.platform === 'win32' ? 'node.exe' : 'node' );
	if ( process.platform === 'win32' ) {
		await fs.copyFile( nodeExecutable, node );
	} else {
		await fs.writeFile(
			node,
			`#!/bin/sh\nexec '${ nodeExecutable.replace( /'/g, "'\\''" ) }' "$@"\n`,
			{
				mode: 0o755,
			}
		);
	}
	await fs.writeFile(
		path.join( fixture, 'cli', 'main.mjs' ),
		`console.log(${ JSON.stringify( version ) });`
	);
	const file = path.join( root, 'release.tgz' );
	await archive( { cwd: fixture, file, gzip: true }, [ 'bin', 'cli' ] );
	return fs.readFile( file );
}

function serveRelease( body: Buffer | string, version = '2.0.0' ) {
	const downloadUrl =
		'https://appscdn.wordpress.com/downloads/wordpress-com-studio-cli/linux-x64/v2.0.0/full-install/studio.tgz';
	const fetchMock = vi.fn( async ( input: string | URL | Request ) =>
		String( input ) === downloadUrl
			? new Response( new Uint8Array( Buffer.from( body ) ) )
			: Response.json( { version, downloadUrl } )
	);
	vi.stubGlobal( 'fetch', fetchMock );
	return fetchMock;
}

it( 'stages a runnable release for the next launch without replacing the current runtime', async () => {
	const fetchMock = serveRelease( await releaseArchive() );
	expect( await updateStandaloneCli( '1.0.0' ) ).toBe( '2.0.0' );
	expect( await fs.readFile( path.join( versionsDirectory, 'current-1.0.0' ), 'utf8' ) ).toBe(
		'2.0.0\n'
	);
	expect( await fs.readFile( path.join( installDirectory, 'cli', 'main.mjs' ), 'utf8' ) ).toBe(
		'original runtime'
	);
	expect( await updateStandaloneCli( '1.0.0' ) ).toBe( '2.0.0' );
	expect( fetchMock ).toHaveBeenCalledTimes( 3 );
	expect( ( await fs.readdir( versionsDirectory ) ).sort() ).toEqual( [
		'2.0.0',
		'current-1.0.0',
	] );
	Object.defineProperty( process, 'execPath', {
		value: path.join( versionsDirectory, '2.0.0', 'bin', 'node' ),
		configurable: true,
	} );
	expect( getStandaloneInstallDir() ).toBe( installDirectory );
} );

it( 'leaves the active runtime intact when a download is corrupt', async () => {
	await fs.mkdir( versionsDirectory, { recursive: true } );
	await fs.writeFile( path.join( versionsDirectory, 'current-1.0.0' ), '1.1.0\n' );
	serveRelease( 'truncated download' );
	await expect( updateStandaloneCli( '1.0.0' ) ).rejects.toThrow();
	expect( await fs.readFile( path.join( versionsDirectory, 'current-1.0.0' ), 'utf8' ) ).toBe(
		'1.1.0\n'
	);
	expect( await fs.readdir( versionsDirectory ) ).toEqual( [ 'current-1.0.0' ] );
} );

it.each( [ true, false ] )( 'remembers the one-time auto-update choice (%s)', async ( enabled ) => {
	terminals.forEach( ( stream ) =>
		Object.defineProperty( stream, 'isTTY', { value: true, configurable: true } )
	);
	vi.mocked( confirm ).mockResolvedValue( enabled );
	const spawn = vi.mocked( childProcess.spawn ).mockReturnValue( {
		on: vi.fn(),
		unref: vi.fn(),
	} as never );
	await setupStandaloneAutoUpdates( 'standalone' );
	await setupStandaloneAutoUpdates( 'standalone' );
	expect( confirm ).toHaveBeenCalledTimes( 1 );
	expect( ( await readCliConfig() ).cliAutoUpdates ).toBe( enabled );
	expect( spawn ).toHaveBeenCalledTimes( enabled ? 2 : 0 );
} );
