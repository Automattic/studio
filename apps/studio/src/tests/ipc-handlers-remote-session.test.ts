/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypedEventEmitter } from 'src/modules/cli/lib/typed-event-emitter';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( '@studio/common/lib/remote-session', async () => {
	const actual = await vi.importActual< typeof import('@studio/common/lib/remote-session') >(
		'@studio/common/lib/remote-session'
	);
	return {
		...actual,
		getDaemonStatus: vi.fn(),
	};
} );

vi.mock( 'src/modules/cli/lib/execute-command', () => ( {
	executeCliCommand: vi.fn(),
	getTracksOriginEnv: vi.fn( () => 'studio-ui:v1' ),
} ) );

vi.mock( 'src/lib/bump-stats', async () => {
	const actual =
		await vi.importActual< typeof import('src/lib/bump-stats') >( 'src/lib/bump-stats' );
	return {
		...actual,
		bumpStat: vi.fn(),
		bumpAggregatedUniqueStat: vi.fn().mockResolvedValue( undefined ),
	};
} );

type CliEmitter = TypedEventEmitter< {
	started: void;
	error: { error: Error };
	data: { data: unknown };
	success: { result: unknown };
	failure: { error: Error };
} >;

const mockIpcEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue( false ) },
} as unknown as IpcMainInvokeEvent;

function stubExecuteCliCommand(
	behavior: ( emitter: CliEmitter, args: string[], options: unknown ) => void
) {
	void ( async () => {
		const { executeCliCommand } = await import( 'src/modules/cli/lib/execute-command' );
		vi.mocked( executeCliCommand ).mockImplementation( ( ( args: string[], options: unknown ) => {
			const emitter = new TypedEventEmitter() as CliEmitter;
			// Defer so the IPC handler can subscribe before events fire.
			queueMicrotask( () => behavior( emitter, args, options ) );
			return [ emitter, {} as never ];
		} ) as unknown as typeof executeCliCommand );
	} )();
}

beforeEach( () => {
	vi.clearAllMocks();
} );

afterEach( () => {
	vi.resetModules();
} );

describe( 'getRemoteSessionDaemonStatus', () => {
	it( 'projects the underlying daemon status to the renderer-facing shape', async () => {
		const { getDaemonStatus } = await import( '@studio/common/lib/remote-session' );
		// Internal `DaemonStatus` is the rich shape — pid, pidFile, etc.
		vi.mocked( getDaemonStatus ).mockReturnValue( {
			running: true,
			pid: 12345,
			pidFile: '/tmp/remote-session.pid',
		} );

		const { getRemoteSessionDaemonStatus } = await import( 'src/ipc-handlers' );
		const result = await getRemoteSessionDaemonStatus( mockIpcEvent );

		// IPC return only carries what the renderer needs (`running`). The
		// `pid` / `pidFile` / `staleFileRemoved` bookkeeping stays on the
		// main-process side.
		expect( result ).toEqual( { running: true } );
		expect( getDaemonStatus ).toHaveBeenCalledOnce();
	} );

	it( 'returns "not running" when no daemon is present', async () => {
		const { getDaemonStatus } = await import( '@studio/common/lib/remote-session' );
		vi.mocked( getDaemonStatus ).mockReturnValue( {
			running: false,
			pidFile: '/tmp/remote-session.pid',
		} );

		const { getRemoteSessionDaemonStatus } = await import( 'src/ipc-handlers' );
		const result = await getRemoteSessionDaemonStatus( mockIpcEvent );

		expect( result.running ).toBe( false );
	} );
} );

describe( 'startRemoteSessionDaemon', () => {
	it( 'forks `code remote-session start` with the CLI feature flag enabled, then reads the live PID file', async () => {
		const recordedCalls: { args: string[]; options: unknown }[] = [];
		stubExecuteCliCommand( ( emitter, args, options ) => {
			recordedCalls.push( { args, options } );
			emitter.emit( 'success', { result: undefined } );
		} );

		const { getDaemonStatus } = await import( '@studio/common/lib/remote-session' );
		vi.mocked( getDaemonStatus ).mockReturnValue( {
			running: true,
			pid: 12345,
			pidFile: '/tmp/remote-session.pid',
		} );

		const { startRemoteSessionDaemon } = await import( 'src/ipc-handlers' );
		const result = await startRemoteSessionDaemon( mockIpcEvent );

		expect( recordedCalls ).toHaveLength( 1 );
		expect( recordedCalls[ 0 ].args ).toEqual( [ 'code', 'remote-session', 'start' ] );
		expect( recordedCalls[ 0 ].options ).toMatchObject( {
			output: 'capture',
			env: { STUDIO_ENABLE_REMOTE_SESSION: 'true' },
		} );
		expect( result ).toEqual( { pid: 12345, pidFile: '/tmp/remote-session.pid' } );
	} );

	it( 'rejects with DaemonStartTimeoutError when the CLI exits 0 but no live PID file is on disk', async () => {
		stubExecuteCliCommand( ( emitter ) => {
			emitter.emit( 'success', { result: undefined } );
		} );

		const { getDaemonStatus, DaemonStartTimeoutError } = await import(
			'@studio/common/lib/remote-session'
		);
		vi.mocked( getDaemonStatus ).mockReturnValue( {
			running: false,
			pidFile: '/tmp/remote-session.pid',
		} );

		const { startRemoteSessionDaemon } = await import( 'src/ipc-handlers' );

		await expect( startRemoteSessionDaemon( mockIpcEvent ) ).rejects.toBeInstanceOf(
			DaemonStartTimeoutError
		);
	} );

	it( 'rejects with the CLI failure error when the subprocess exits non-zero', async () => {
		const failure = new Error( 'CLI exited with code 1' );
		stubExecuteCliCommand( ( emitter ) => {
			emitter.emit( 'failure', { error: failure } );
		} );

		const { startRemoteSessionDaemon } = await import( 'src/ipc-handlers' );

		await expect( startRemoteSessionDaemon( mockIpcEvent ) ).rejects.toBe( failure );
	} );

	it( 'bumps the desktop-side start stat and weekly/monthly uniques', async () => {
		stubExecuteCliCommand( ( emitter ) => {
			emitter.emit( 'success', { result: undefined } );
		} );

		const { getDaemonStatus } = await import( '@studio/common/lib/remote-session' );
		vi.mocked( getDaemonStatus ).mockReturnValue( {
			running: true,
			pid: 12345,
			pidFile: '/tmp/remote-session.pid',
		} );

		const bumpStats = await import( 'src/lib/bump-stats' );
		const { startRemoteSessionDaemon } = await import( 'src/ipc-handlers' );

		await startRemoteSessionDaemon( mockIpcEvent );

		expect( bumpStats.bumpStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_DOLLY_START,
			expect.any( String )
		);
		expect( bumpStats.bumpAggregatedUniqueStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_DOLLY_WKLY_UNQ,
			expect.any( String ),
			'weekly'
		);
		expect( bumpStats.bumpAggregatedUniqueStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_DOLLY_MON_UNQ,
			expect.any( String ),
			'monthly'
		);
	} );
} );

describe( 'stopRemoteSessionDaemon', () => {
	it( 'forks `code remote-session stop` with the CLI feature flag enabled and returns a `stopped` result', async () => {
		const recordedCalls: { args: string[]; options: unknown }[] = [];
		stubExecuteCliCommand( ( emitter, args, options ) => {
			recordedCalls.push( { args, options } );
			emitter.emit( 'success', { result: undefined } );
		} );

		const { getDaemonStatus } = await import( '@studio/common/lib/remote-session' );
		vi.mocked( getDaemonStatus ).mockReturnValue( {
			running: false,
			pidFile: '/tmp/remote-session.pid',
		} );

		const { stopRemoteSessionDaemon } = await import( 'src/ipc-handlers' );
		const result = await stopRemoteSessionDaemon( mockIpcEvent );

		expect( recordedCalls ).toHaveLength( 1 );
		expect( recordedCalls[ 0 ].args ).toEqual( [ 'code', 'remote-session', 'stop' ] );
		// REGRESSION GUARD: the CLI gates the entire `code remote-session`
		// subcommand tree behind `STUDIO_ENABLE_REMOTE_SESSION=true`. Without
		// it, yargs reports "Unknown argument: stop" and the IPC handler
		// rejects with CliCommandError.
		expect( recordedCalls[ 0 ].options ).toMatchObject( {
			env: { STUDIO_ENABLE_REMOTE_SESSION: 'true' },
		} );
		expect( result.stopped ).toBe( true );
	} );

	it( 'rejects with the CLI failure error when the subprocess exits non-zero', async () => {
		const failure = new Error( 'PID file refused to clean up' );
		stubExecuteCliCommand( ( emitter ) => {
			emitter.emit( 'failure', { error: failure } );
		} );

		const { stopRemoteSessionDaemon } = await import( 'src/ipc-handlers' );

		await expect( stopRemoteSessionDaemon( mockIpcEvent ) ).rejects.toBe( failure );
	} );

	it( 'bumps the desktop-side stop stat', async () => {
		stubExecuteCliCommand( ( emitter ) => {
			emitter.emit( 'success', { result: undefined } );
		} );

		const bumpStats = await import( 'src/lib/bump-stats' );
		const { stopRemoteSessionDaemon } = await import( 'src/ipc-handlers' );

		await stopRemoteSessionDaemon( mockIpcEvent );

		expect( bumpStats.bumpStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_DOLLY_STOP,
			expect.any( String )
		);
	} );
} );
