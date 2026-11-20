import EventEmitter from 'node:events';
import { CliCommandError, killChild } from '@studio/common/lib/cli-process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { isProcessAlive, startRemote } from 'src/modules/phone-access/lib/remote-process';

vi.mock( 'src/modules/cli/lib/execute-command', () => ( { executeCliCommand: vi.fn() } ) );
vi.mock( '@studio/common/lib/cli-process', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/cli-process') >() ),
	killChild: vi.fn(),
} ) );

function fakeRun() {
	const events = new EventEmitter();
	const child = { pid: 4242, kill: vi.fn() };
	vi.mocked( executeCliCommand ).mockReturnValue( [ events, child ] as unknown as ReturnType<
		typeof executeCliCommand
	> );
	return { events, child };
}

function failure( lastErrorMessage?: string ) {
	return new CliCommandError( {
		lastErrorMessage,
		cliCommandResult: undefined,
		exitCode: 1,
		signal: null,
	} );
}

afterEach( () => {
	vi.unstubAllEnvs();
} );

describe( 'startRemote', () => {
	it( "runs the bundled CLI's `studio remote` on the port over the connection, or on the address STUDIO_REMOTE_HOST names", () => {
		fakeRun();
		startRemote( 8098, 'https' );
		expect( executeCliCommand ).toHaveBeenLastCalledWith(
			[ 'remote', '--port', '8098', '--connection', 'https' ],
			{ output: 'ignore' }
		);

		vi.stubEnv( 'STUDIO_REMOTE_HOST', '127.0.0.1' );
		const remote = startRemote( 8098, 'auto' );
		expect( executeCliCommand ).toHaveBeenLastCalledWith(
			[ 'remote', '--port', '8098', '--host', '127.0.0.1' ],
			{ output: 'ignore' }
		);
		expect( remote.pid ).toBe( 4242 );
	} );

	it( "tells once when it ends, with the CLI's error message when it failed", () => {
		const { events } = fakeRun();
		const remote = startRemote( 8082, 'auto' );
		const ended = vi.fn();
		remote.onExit( ended );

		events.emit( 'failure', {
			error: failure( 'No network address found. Pass one with --host.' ),
		} );
		events.emit( 'success', { result: undefined } );

		expect( ended ).toHaveBeenCalledTimes( 1 );
		expect( ended ).toHaveBeenCalledWith( 'No network address found. Pass one with --host.' );
	} );

	it( 'tells a listener that comes after the end, and a failure without a message', () => {
		const { events } = fakeRun();
		const remote = startRemote( 8082, 'auto' );
		events.emit( 'failure', { error: failure() } );

		const ended = vi.fn();
		remote.onExit( ended );

		expect( ended ).toHaveBeenCalledWith( undefined );
	} );

	it( "ends with no message when it stops cleanly, and stops the way the app's CLI runner does", () => {
		const { events, child } = fakeRun();
		const remote = startRemote( 8082, 'auto' );
		const ended = vi.fn();
		remote.onExit( ended );

		remote.stop();
		events.emit( 'success', { result: undefined } );

		expect( killChild ).toHaveBeenCalledWith( child );
		expect( ended ).toHaveBeenCalledWith( undefined );
	} );
} );

describe( 'isProcessAlive', () => {
	it( 'says whether a process runs', () => {
		expect( isProcessAlive( process.pid ) ).toBe( true );
		expect( isProcessAlive( 2 ** 22 + 12345 ) ).toBe( false );
	} );
} );
