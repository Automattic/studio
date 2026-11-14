import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	getDaemonBus,
	isProcessRunning,
	startProcess,
	stopProcess,
	type DaemonBus,
} from 'cli/lib/daemon-client';
import { FRONTEND_CHILD_ENV } from 'cli/lib/frontend/child-config';
import {
	detectNodeRuntime,
	getFrontendEnv,
	getFrontendLogPaths,
	getFrontendProcessName,
	readFrontendLogTail,
	resetNodeRuntimeCache,
	startFrontendServer,
	type HeadlessSite,
} from 'cli/lib/frontend/server';
import { LoggerError } from 'cli/logger';
import type { ChildProcess } from 'child_process';

vi.mock( 'cli/lib/paths', async ( importOriginal ) => {
	const nodeOs = await import( 'os' );
	const nodePath = await import( 'path' );
	return {
		...( await importOriginal< typeof import('cli/lib/paths') >() ),
		PROCESS_MANAGER_LOGS_DIR: nodePath.join(
			nodeOs.tmpdir(),
			`studio-frontend-logs-test-${ process.pid }`
		),
	};
} );
vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'child_process', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('child_process') >() ),
	spawn: vi.fn(),
} ) );

function mockShellOutput( stdout: string ) {
	vi.mocked( spawn ).mockImplementation( () => {
		const child = new EventEmitter() as ChildProcess;
		const stdoutStream = new EventEmitter();
		Object.assign( child, { stdout: stdoutStream, pid: 999, kill: vi.fn() } );
		setImmediate( () => {
			stdoutStream.emit( 'data', Buffer.from( stdout ) );
			child.emit( 'close', 0 );
		} );
		return child;
	} );
}

const logsDir = path.join( os.tmpdir(), `studio-frontend-logs-test-${ process.pid }` );

const NODE_OUTPUT =
	'__STUDIO_NODE_BEGIN__\n/opt/node/bin/node\nv22.11.0\n/opt/node/bin/npm\n__STUDIO_NODE_END__\n';

describe( 'frontend server', () => {
	let projectDir: string;
	let bus: EventEmitter;

	const site = ( frontend: Partial< HeadlessSite[ 'frontend' ] > = {} ): HeadlessSite => ( {
		id: 'site-1',
		name: 'Headless',
		path: '/sites/headless/wordpress',
		port: 8881,
		phpVersion: '8.3',
		frontend: {
			path: projectDir,
			kind: 'static',
			port: 4321,
			previewSecret: 'preview',
			...frontend,
		},
	} );

	beforeEach( () => {
		vi.clearAllMocks();
		resetNodeRuntimeCache();
		projectDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-frontend-project-' ) );
		bus = new EventEmitter();
		vi.mocked( getDaemonBus ).mockResolvedValue( bus as unknown as DaemonBus );
		vi.mocked( isProcessRunning ).mockResolvedValue( undefined );
		vi.mocked( stopProcess ).mockResolvedValue( undefined );
		fs.mkdirSync( logsDir, { recursive: true } );
		for ( const entry of fs.readdirSync( logsDir ) ) {
			fs.rmSync( path.join( logsDir, entry ) );
		}
	} );

	afterEach( () => {
		fs.rmSync( projectDir, { recursive: true, force: true } );
	} );

	afterAll( () => {
		fs.rmSync( logsDir, { recursive: true, force: true } );
	} );

	describe( 'getFrontendEnv', () => {
		it( 'builds the contract and reads the application password from .env.local', () => {
			fs.writeFileSync(
				path.join( projectDir, '.env.local' ),
				'WORDPRESS_APPLICATION_USER="studio-frontend"\nWORDPRESS_APPLICATION_PASSWORD="abcd efgh"\n'
			);

			expect( getFrontendEnv( site() ) ).toEqual( {
				WORDPRESS_URL: 'http://localhost:8881',
				WORDPRESS_HOSTNAME: 'localhost',
				PORT: '4321',
				WORDPRESS_APPLICATION_USER: 'studio-frontend',
				WORDPRESS_APPLICATION_PASSWORD: 'abcd efgh',
				STUDIO_PREVIEW_SECRET: 'preview',
			} );
		} );

		it( 'works without a .env.local', () => {
			expect( getFrontendEnv( site() ) ).not.toHaveProperty( 'WORDPRESS_APPLICATION_PASSWORD' );
		} );
	} );

	describe( 'logs', () => {
		const name = getFrontendProcessName( 'site-1' );

		it( 'uses the newest dated log files', () => {
			fs.writeFileSync( path.join( logsDir, `${ name }-out-20261029.log` ), '' );
			fs.writeFileSync( path.join( logsDir, `${ name }-out-20261030.log` ), '' );
			fs.writeFileSync( path.join( logsDir, `${ name }-error-20261030.log` ), '' );
			fs.writeFileSync( path.join( logsDir, `${ name }0-out-20261231.log` ), '' );

			expect( getFrontendLogPaths( 'site-1' ) ).toEqual( {
				out: path.join( logsDir, `${ name }-out-20261030.log` ),
				error: path.join( logsDir, `${ name }-error-20261030.log` ),
			} );
		} );

		it( "falls back to today's file names", () => {
			const { out } = getFrontendLogPaths( 'site-1' );
			expect( path.basename( out ) ).toMatch( new RegExp( `^${ name }-out-\\d{8}\\.log$` ) );
		} );

		it( 'merges stdout and stderr in time order', () => {
			fs.writeFileSync(
				path.join( logsDir, `${ name }-out-20261030.log` ),
				'2026-10-30T10:00:00.000Z ready\n2026-10-30T10:00:02.000Z GET /\n'
			);
			fs.writeFileSync(
				path.join( logsDir, `${ name }-error-20261030.log` ),
				'2026-10-30T10:00:01.000Z warning\n'
			);

			expect( readFrontendLogTail( 'site-1', 2 ) ).toEqual( [
				'2026-10-30T10:00:01.000Z warning',
				'2026-10-30T10:00:02.000Z GET /',
			] );
		} );
	} );

	describe( 'detectNodeRuntime', () => {
		it( 'resolves node through the login shell once per process', async () => {
			mockShellOutput( NODE_OUTPUT );

			await expect( detectNodeRuntime() ).resolves.toEqual( {
				nodePath: '/opt/node/bin/node',
				version: 'v22.11.0',
				npmPath: '/opt/node/bin/npm',
			} );
			await detectNodeRuntime();
			expect( spawn ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'returns undefined when no shell finds node', async () => {
			mockShellOutput( '__STUDIO_NODE_BEGIN__\n__STUDIO_NODE_END__\n' );

			await expect( detectNodeRuntime() ).resolves.toBeUndefined();
		} );
	} );

	describe( 'startFrontendServer', () => {
		function emitWhenStarted( message: 'ready' | 'exit', stderrTail?: string ) {
			vi.mocked( startProcess ).mockImplementation( async ( processName ) => {
				setImmediate( () => {
					if ( message === 'ready' ) {
						bus.emit( 'process-message', {
							process: { name: processName, pm_id: 7 },
							raw: { topic: 'ready' },
						} );
					} else {
						bus.emit( 'process-event', {
							process: { name: processName, pm_id: 7 },
							event: 'exit',
							stderrTail,
						} );
					}
				} );
				return { name: processName, pmId: 7, status: 'online', pid: 1234 };
			} );
		}

		it( 'starts a static frontend and waits for it to be ready', async () => {
			emitWhenStarted( 'ready' );

			await expect( startFrontendServer( site() ) ).resolves.toMatchObject( { pmId: 7 } );

			const [ processName, scriptPath, options ] = vi.mocked( startProcess ).mock.calls[ 0 ];
			expect( processName ).toBe( 'studio-frontend-site-1' );
			expect( path.basename( scriptPath ) ).toBe( 'frontend-server-child.mjs' );
			expect( options?.env ).toMatchObject( {
				[ FRONTEND_CHILD_ENV.KIND ]: 'static',
				[ FRONTEND_CHILD_ENV.PORT ]: '4321',
				[ FRONTEND_CHILD_ENV.SERVED_DIR ]: path.resolve( projectDir ),
				WORDPRESS_URL: 'http://localhost:8881',
			} );
			expect( bus.listenerCount( 'process-message' ) ).toBe( 0 );
		} );

		it( 'returns the running process without starting another', async () => {
			const running = {
				name: 'studio-frontend-site-1',
				pmId: 3,
				status: 'online' as const,
				pid: 42,
			};
			vi.mocked( isProcessRunning ).mockResolvedValue( running );

			await expect( startFrontendServer( site() ) ).resolves.toBe( running );
			expect( startProcess ).not.toHaveBeenCalled();
		} );

		it( 'reports the child output when it exits before it is ready', async () => {
			emitWhenStarted( 'exit', 'Port 4321 is already in use by another process' );

			await expect( startFrontendServer( site() ) ).rejects.toThrow(
				/Failed to start the frontend[\s\S]*Port 4321 is already in use/
			);
			expect( stopProcess ).toHaveBeenCalledWith( 'studio-frontend-site-1' );
		} );

		it( 'fails clearly when a static frontend has no served folder', async () => {
			await expect( startFrontendServer( site( { servedDir: 'dist' } ) ) ).rejects.toThrow(
				/served folder .*dist.* does not exist/
			);
			expect( startProcess ).not.toHaveBeenCalled();
		} );

		it( 'requires Node.js for a command frontend', async () => {
			mockShellOutput( '' );

			const promise = startFrontendServer(
				site( { kind: 'command', devCommand: 'npm run dev -- --port ${port}' } )
			);
			await expect( promise ).rejects.toBeInstanceOf( LoggerError );
			await expect( promise ).rejects.toThrow( /Node\.js 20 or later is required.*nodejs\.org/ );
			expect( startProcess ).not.toHaveBeenCalled();
		} );

		it( 'rejects a Node.js older than 20', async () => {
			mockShellOutput(
				'__STUDIO_NODE_BEGIN__\n/usr/local/bin/node\nv18.20.0\n__STUDIO_NODE_END__\n'
			);

			await expect(
				startFrontendServer( site( { kind: 'command', devCommand: 'npm run dev' } ) )
			).rejects.toThrow( /v18\.20\.0 was found/ );
		} );

		it( 'passes the resolved command and node directory to the child', async () => {
			mockShellOutput( NODE_OUTPUT );
			emitWhenStarted( 'ready' );

			await startFrontendServer(
				site( { kind: 'command', devCommand: 'npm run dev -- --port ${port}', port: 3000 } )
			);

			expect( vi.mocked( startProcess ).mock.calls[ 0 ][ 2 ]?.env ).toMatchObject( {
				[ FRONTEND_CHILD_ENV.KIND ]: 'command',
				[ FRONTEND_CHILD_ENV.COMMAND ]: 'npm run dev -- --port 3000',
				[ FRONTEND_CHILD_ENV.NODE_BIN_DIR ]: '/opt/node/bin',
				PORT: '3000',
			} );
		} );
	} );
} );
