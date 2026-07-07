import { spawn as realSpawn, type spawn } from 'child_process';
import { EventEmitter } from 'events';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	buildSshCommandArgs,
	describeSshFailure,
	ensureRelativeSitePath,
	execSsh,
	isValidSshDestination,
	probeSshWordPressSite,
	shellQuote,
	type SshConnection,
} from 'cli/lib/ssh';

interface FakeProcessBehavior {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

function createSpawnMock( behavior: FakeProcessBehavior = {} ) {
	const stdinWrites: string[] = [];
	const spawnMock = vi.fn( () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const child = new EventEmitter() as any;
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.stdin = {
			on: vi.fn(),
			write: ( data: string ) => stdinWrites.push( data ),
			end: vi.fn(),
		};
		child.kill = vi.fn();
		process.nextTick( () => {
			if ( behavior.stdout ) {
				child.stdout.emit( 'data', Buffer.from( behavior.stdout ) );
			}
			if ( behavior.stderr ) {
				child.stderr.emit( 'data', Buffer.from( behavior.stderr ) );
			}
			child.emit( 'close', behavior.exitCode ?? 0 );
		} );
		return child;
	} );
	return { spawnMock: spawnMock as unknown as typeof spawn, stdinWrites };
}

const connection: SshConnection = {
	destination: 'deploy@example.com',
	remotePath: '/var/www/html',
};

describe( 'isValidSshDestination', () => {
	it( 'accepts hosts, user@host, and ssh-config aliases', () => {
		expect( isValidSshDestination( 'example.com' ) ).toBe( true );
		expect( isValidSshDestination( 'deploy@example.com' ) ).toBe( true );
		expect( isValidSshDestination( 'my-prod-alias' ) ).toBe( true );
		expect( isValidSshDestination( 'user@192.168.1.10' ) ).toBe( true );
	} );

	it( 'rejects option injection, whitespace, and shell metacharacters', () => {
		expect( isValidSshDestination( '-oProxyCommand=evil' ) ).toBe( false );
		expect( isValidSshDestination( 'host -p 2222' ) ).toBe( false );
		expect( isValidSshDestination( 'host;rm -rf /' ) ).toBe( false );
		expect( isValidSshDestination( '' ) ).toBe( false );
	} );
} );

describe( 'shellQuote', () => {
	it( 'single-quotes values and escapes embedded single quotes', () => {
		expect( shellQuote( 'plain' ) ).toBe( "'plain'" );
		expect( shellQuote( 'a b; rm -rf /' ) ).toBe( "'a b; rm -rf /'" );
		expect( shellQuote( "it's" ) ).toBe( `'it'\\''s'` );
	} );
} );

describe( 'ensureRelativeSitePath', () => {
	it( 'normalizes paths relative to the WordPress root', () => {
		expect( ensureRelativeSitePath( 'wp-content/themes/./x/style.css' ) ).toBe(
			'wp-content/themes/x/style.css'
		);
		expect( ensureRelativeSitePath( '.' ) ).toBe( '.' );
	} );

	it( 'rejects absolute paths and traversal outside the root', () => {
		expect( () => ensureRelativeSitePath( '/etc/passwd' ) ).toThrow( /must be relative/ );
		expect( () => ensureRelativeSitePath( '../other-site' ) ).toThrow( /must be relative/ );
		expect( () => ensureRelativeSitePath( 'wp-content/../../escape' ) ).toThrow(
			/must be relative/
		);
	} );
} );

describe( 'buildSshCommandArgs', () => {
	it( 'runs non-interactively with safe host-key handling', () => {
		const args = buildSshCommandArgs( connection, 'wp option get home' );
		const options = args.join( ' ' );
		expect( options ).toContain( 'BatchMode=yes' );
		expect( options ).toContain( 'StrictHostKeyChecking=accept-new' );
		expect( options ).toContain( 'ConnectTimeout=15' );
		expect( args.slice( -3 ) ).toEqual( [ '--', 'deploy@example.com', 'wp option get home' ] );
	} );

	// A lingering ControlMaster holds the command's stdout/stderr pipes open,
	// so Node's child `close` never fires and execSsh hangs. Commands must be
	// one-off connections with no persistent master.
	it( 'never enables ControlMaster/ControlPersist multiplexing', () => {
		const args = buildSshCommandArgs( connection, 'wp option get home' ).join( ' ' );
		expect( args ).not.toContain( 'ControlMaster' );
		expect( args ).not.toContain( 'ControlPersist' );
		expect( args ).not.toContain( 'ControlPath' );
	} );

	it( 'includes the port when provided', () => {
		const args = buildSshCommandArgs( { destination: 'example.com', port: 2222 }, 'true' );
		expect( args ).toContain( '-p' );
		expect( args ).toContain( '2222' );
	} );

	it( 'rejects invalid destinations', () => {
		expect( () => buildSshCommandArgs( { destination: '-oProxyCommand=evil' }, 'true' ) ).toThrow(
			/Invalid SSH destination/
		);
	} );
} );

describe( 'execSsh', () => {
	let configDir: string;

	beforeEach( async () => {
		configDir = await mkdtemp( path.join( os.tmpdir(), 'studio-ssh-test-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	} );

	afterEach( async () => {
		vi.unstubAllEnvs();
		await rm( configDir, { recursive: true, force: true } );
	} );

	it( 'resolves with stdout, stderr, and exit code', async () => {
		const { spawnMock } = createSpawnMock( { stdout: 'ok\n', exitCode: 0 } );
		const result = await execSsh( connection, 'echo ok', { spawnImplementation: spawnMock } );
		expect( result ).toEqual( { stdout: 'ok\n', stderr: '', exitCode: 0 } );
	} );

	// Regression for the ControlMaster hang: with a real child process and real
	// pipes, execSsh must resolve as soon as the command exits — not wait on a
	// lingering connection. Runs `sh` in place of `ssh` via spawnImplementation.
	it( 'resolves promptly against a real one-off child process', async () => {
		const shAsSsh = ( ( _bin: string, _args: string[], opts: object ) =>
			realSpawn( 'sh', [ '-c', 'printf hello-remote' ], opts ) ) as unknown as typeof spawn;
		const start = Date.now();
		const result = await execSsh( connection, 'ignored', { spawnImplementation: shAsSsh } );
		expect( result.stdout ).toBe( 'hello-remote' );
		expect( result.exitCode ).toBe( 0 );
		expect( Date.now() - start ).toBeLessThan( 3000 );
	} );

	it( 'pipes stdin to the remote command', async () => {
		const { spawnMock, stdinWrites } = createSpawnMock( { exitCode: 0 } );
		await execSsh( connection, 'cat > file', {
			stdin: 'file content',
			spawnImplementation: spawnMock,
		} );
		expect( stdinWrites ).toEqual( [ 'file content' ] );
	} );

	it( 'fails with install guidance when ssh is missing', async () => {
		const spawnMock = vi.fn( () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const child = new EventEmitter() as any;
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.kill = vi.fn();
			process.nextTick( () => {
				const error: NodeJS.ErrnoException = new Error( 'spawn ssh ENOENT' );
				error.code = 'ENOENT';
				child.emit( 'error', error );
			} );
			return child;
		} );
		await expect(
			execSsh( connection, 'true', { spawnImplementation: spawnMock as unknown as typeof spawn } )
		).rejects.toThrow( /OpenSSH/ );
	} );
} );

describe( 'describeSshFailure', () => {
	it( 'explains ssh transport failures (exit 255)', () => {
		const message = describeSshFailure(
			{ stdout: '', stderr: 'Permission denied (publickey).', exitCode: 255 },
			connection
		);
		expect( message ).toContain( 'Could not connect to deploy@example.com' );
		expect( message ).toContain( 'Permission denied (publickey).' );
	} );

	it( 'explains missing WP-CLI (exit 127)', () => {
		const message = describeSshFailure(
			{ stdout: '', stderr: 'sh: wp: command not found', exitCode: 127 },
			connection
		);
		expect( message ).toContain( 'WP-CLI was not found' );
	} );
} );

describe( 'probeSshWordPressSite', () => {
	let configDir: string;

	beforeEach( async () => {
		configDir = await mkdtemp( path.join( os.tmpdir(), 'studio-ssh-test-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	} );

	afterEach( async () => {
		vi.unstubAllEnvs();
		await rm( configDir, { recursive: true, force: true } );
	} );

	it( 'reads the home URL and site name in one round-trip', async () => {
		const { spawnMock } = createSpawnMock( {
			stdout: 'https://example.com\nMy Site\n',
			exitCode: 0,
		} );
		const probe = await probeSshWordPressSite( connection, { spawnImplementation: spawnMock } );
		expect( probe ).toEqual( { homeUrl: 'https://example.com', siteName: 'My Site' } );

		const remoteCommand = ( spawnMock as ReturnType< typeof vi.fn > ).mock
			.calls[ 0 ][ 1 ] as string[];
		expect( remoteCommand[ remoteCommand.length - 1 ] ).toBe(
			`cd '/var/www/html' && 'wp' option get home && 'wp' option get blogname`
		);
	} );

	it( 'falls back to the hostname when the site name is empty', async () => {
		const { spawnMock } = createSpawnMock( { stdout: 'https://example.com\n', exitCode: 0 } );
		const probe = await probeSshWordPressSite( connection, { spawnImplementation: spawnMock } );
		expect( probe.siteName ).toBe( 'example.com' );
	} );

	it( 'rejects when the output is not a WordPress home URL', async () => {
		const { spawnMock } = createSpawnMock( { stdout: 'not-a-url\n', exitCode: 0 } );
		await expect(
			probeSshWordPressSite( connection, { spawnImplementation: spawnMock } )
		).rejects.toThrow( /Could not read the site URL/ );
	} );

	it( 'surfaces connection failures with guidance', async () => {
		const { spawnMock } = createSpawnMock( {
			stderr: 'Permission denied (publickey).',
			exitCode: 255,
		} );
		await expect(
			probeSshWordPressSite( connection, { spawnImplementation: spawnMock } )
		).rejects.toThrow( /Could not connect/ );
	} );
} );
