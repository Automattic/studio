import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockChildProcess extends EventEmitter {
	pid = 9999;
	kill = vi.fn();
}

const spawnMock = vi.fn();

vi.mock( 'child_process', () => {
	const mockedModule = {
		spawn: spawnMock,
	};
	return {
		...mockedModule,
		default: mockedModule,
	};
} );

const resolveDlaCliEntryMock = vi.fn();
const resolveTsxCliMock = vi.fn();

vi.mock( 'cli/commands/migrate/resolvers', () => ( {
	resolveDlaCliEntry: () => resolveDlaCliEntryMock(),
	resolveTsxCli: () => resolveTsxCliMock(),
} ) );

describe( 'CLI: studio migrate', () => {
	const tsxCliPath = '/abs/path/to/tsx/dist/cli.mjs';
	const dlaCliPath = '/abs/path/to/data-liberation/src/cli.ts';
	let child: MockChildProcess;
	let originalExitCode: typeof process.exitCode;
	let processOnSpy: ReturnType< typeof vi.spyOn >;
	let processOffSpy: ReturnType< typeof vi.spyOn >;
	let signalHandlers: Map< string, ( ( ...args: unknown[] ) => void )[] >;

	beforeEach( () => {
		vi.clearAllMocks();

		child = new MockChildProcess();
		spawnMock.mockReturnValue( child );
		resolveDlaCliEntryMock.mockReturnValue( dlaCliPath );
		resolveTsxCliMock.mockReturnValue( tsxCliPath );

		originalExitCode = process.exitCode;

		// Capture signal handlers registered by runCommand without
		// actually wiring them to the test process.
		signalHandlers = new Map();
		processOnSpy = vi.spyOn( process, 'on' ).mockImplementation( ( (
			event: string,
			handler: ( ...args: unknown[] ) => void
		) => {
			const existing = signalHandlers.get( event ) ?? [];
			existing.push( handler );
			signalHandlers.set( event, existing );
			return process;
		} ) as never );
		processOffSpy = vi.spyOn( process, 'off' ).mockImplementation( ( (
			event: string,
			handler: ( ...args: unknown[] ) => void
		) => {
			const existing = signalHandlers.get( event ) ?? [];
			signalHandlers.set(
				event,
				existing.filter( ( h ) => h !== handler )
			);
			return process;
		} ) as never );
	} );

	afterEach( () => {
		process.exitCode = originalExitCode;
		processOnSpy.mockRestore();
		processOffSpy.mockRestore();
	} );

	it( 'spawns the DLA CLI under tsx with process.execPath and the URL forwarded', async () => {
		const { runCommand } = await import( '../index' );

		const runPromise = runCommand( 'https://example.com', [] );
		// Simulate clean child exit.
		child.emit( 'exit', 0, null );
		await runPromise;

		expect( spawnMock ).toHaveBeenCalledTimes( 1 );
		const [ command, args, options ] = spawnMock.mock.calls[ 0 ];
		expect( command ).toBe( process.execPath );
		expect( args ).toEqual( [ tsxCliPath, dlaCliPath, 'https://example.com' ] );
		expect( options.stdio ).toBe( 'inherit' );
	} );

	it( 'appends pass-through args after the URL', async () => {
		const { runCommand } = await import( '../index' );

		const runPromise = runCommand( 'https://example.com', [
			'--output',
			'/tmp/out',
			'--non-interactive',
		] );
		child.emit( 'exit', 0, null );
		await runPromise;

		const [ , args ] = spawnMock.mock.calls[ 0 ];
		expect( args ).toEqual( [
			tsxCliPath,
			dlaCliPath,
			'https://example.com',
			'--output',
			'/tmp/out',
			'--non-interactive',
		] );
	} );

	it( 'forwards LIBERATION_TOKEN and SHOPIFY_ADMIN_TOKEN but never STUDIO_WPCOM_TOKEN', async () => {
		const { runCommand } = await import( '../index' );

		const previousLiberation = process.env.LIBERATION_TOKEN;
		const previousShopify = process.env.SHOPIFY_ADMIN_TOKEN;
		const previousWpcom = process.env.STUDIO_WPCOM_TOKEN;
		process.env.LIBERATION_TOKEN = 'liberation-secret';
		process.env.SHOPIFY_ADMIN_TOKEN = 'shopify-secret';
		process.env.STUDIO_WPCOM_TOKEN = 'wpcom-secret';

		try {
			const runPromise = runCommand( 'https://example.com', [] );
			child.emit( 'exit', 0, null );
			await runPromise;
		} finally {
			process.env.LIBERATION_TOKEN = previousLiberation;
			process.env.SHOPIFY_ADMIN_TOKEN = previousShopify;
			process.env.STUDIO_WPCOM_TOKEN = previousWpcom;
		}

		const [ , , options ] = spawnMock.mock.calls[ 0 ];
		expect( options.env.LIBERATION_TOKEN ).toBe( 'liberation-secret' );
		expect( options.env.SHOPIFY_ADMIN_TOKEN ).toBe( 'shopify-secret' );
		expect( options.env.STUDIO_WPCOM_TOKEN ).toBeUndefined();
	} );

	it( 'forwards SIGINT to the child process', async () => {
		const { runCommand } = await import( '../index' );

		const runPromise = runCommand( 'https://example.com', [] );

		const sigintHandlers = signalHandlers.get( 'SIGINT' ) ?? [];
		expect( sigintHandlers.length ).toBeGreaterThanOrEqual( 1 );
		sigintHandlers[ 0 ]( 'SIGINT' );

		expect( child.kill ).toHaveBeenCalledWith( 'SIGINT' );

		child.emit( 'exit', 0, null );
		await runPromise;
	} );

	it( 'forwards SIGTERM to the child process', async () => {
		const { runCommand } = await import( '../index' );

		const runPromise = runCommand( 'https://example.com', [] );

		const sigtermHandlers = signalHandlers.get( 'SIGTERM' ) ?? [];
		expect( sigtermHandlers.length ).toBeGreaterThanOrEqual( 1 );
		sigtermHandlers[ 0 ]( 'SIGTERM' );

		expect( child.kill ).toHaveBeenCalledWith( 'SIGTERM' );

		child.emit( 'exit', 0, null );
		await runPromise;
	} );

	it( 'sets process.exitCode to the child exit code on non-zero exit', async () => {
		const { runCommand } = await import( '../index' );

		const runPromise = runCommand( 'https://example.com', [] );
		child.emit( 'exit', 7, null );
		await runPromise;

		expect( process.exitCode ).toBe( 7 );
	} );

	it( 'maps a signal-terminated exit to a 128+signal exit code', async () => {
		const { runCommand } = await import( '../index' );

		const runPromise = runCommand( 'https://example.com', [] );
		child.emit( 'exit', null, 'SIGINT' );
		await runPromise;

		// 128 + 2 (SIGINT)
		expect( process.exitCode ).toBe( 130 );
	} );

	it( 'reports a clean error when DLA cannot be resolved instead of crashing', async () => {
		resolveDlaCliEntryMock.mockImplementation( () => {
			const err = new Error( "Cannot find module 'data-liberation/src/cli.ts'" );
			( err as NodeJS.ErrnoException ).code = 'MODULE_NOT_FOUND';
			throw err;
		} );

		const consoleErrorSpy = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		const { runCommand } = await import( '../index' );

		await runCommand( 'https://example.com', [] );

		expect( spawnMock ).not.toHaveBeenCalled();
		expect( process.exitCode ).toBe( 1 );
		expect( consoleErrorSpy ).toHaveBeenCalled();
		const message = consoleErrorSpy.mock.calls.map( ( call ) => call.join( ' ' ) ).join( '\n' );
		expect( message ).toMatch( /data-liberation/i );
		consoleErrorSpy.mockRestore();
	} );

	it( 'reports a clean error when the child emits an error event', async () => {
		const consoleErrorSpy = vi.spyOn( console, 'error' ).mockImplementation( () => undefined );

		const { runCommand } = await import( '../index' );

		const runPromise = runCommand( 'https://example.com', [] );
		child.emit( 'error', new Error( 'spawn ENOENT' ) );
		await runPromise;

		expect( process.exitCode ).toBe( 1 );
		expect( consoleErrorSpy ).toHaveBeenCalled();
		consoleErrorSpy.mockRestore();
	} );

	it( 'registers the migrate command on yargs with the expected metadata', async () => {
		const yargs = ( await import( 'yargs' ) ).default;
		const { registerCommand } = await import( '../index' );

		const argv = yargs().option( 'path', {
			type: 'string',
			normalize: true,
			default: process.cwd(),
		} );
		registerCommand( argv as never );

		const helpOutput = await argv.getHelp();
		expect( helpOutput ).toMatch( /migrate <url>/ );
	} );
} );
