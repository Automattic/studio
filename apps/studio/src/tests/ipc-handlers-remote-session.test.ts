/**
 * @vitest-environment node
 */
import { DaemonAlreadyRunningError, DaemonStartTimeoutError } from 'cli/remote-session/daemon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'cli/remote-session/daemon', async () => {
	const actual = await vi.importActual< typeof import('cli/remote-session/daemon') >(
		'cli/remote-session/daemon'
	);
	return {
		...actual,
		getDaemonStatus: vi.fn(),
		startDaemon: vi.fn(),
		stopDaemon: vi.fn(),
	};
} );

// `src/storage/paths` is mocked globally in `vitest.setup.ts` with stable values:
//   getBundledNodeBinaryPath -> '/mock/node/binary'
//   getCliPath               -> '/mock/cli/path'
// We assert against those values below so the override-passing regression test
// reflects exactly what the renderer will see in test runs.

const mockIpcEvent = {
	sender: { isDestroyed: vi.fn().mockReturnValue( false ) },
} as unknown as IpcMainInvokeEvent;

beforeEach( () => {
	vi.clearAllMocks();
} );

afterEach( () => {
	vi.resetModules();
} );

describe( 'getRemoteSessionDaemonStatus', () => {
	it( 'returns the underlying daemon status', async () => {
		const { getDaemonStatus } = await import( 'cli/remote-session/daemon' );
		vi.mocked( getDaemonStatus ).mockReturnValue( {
			running: true,
			pid: 12345,
			pidFile: '/tmp/remote-session.pid',
		} );

		const { getRemoteSessionDaemonStatus } = await import( 'src/ipc-handlers' );
		const result = await getRemoteSessionDaemonStatus( mockIpcEvent );

		expect( result ).toEqual( {
			running: true,
			pid: 12345,
			pidFile: '/tmp/remote-session.pid',
		} );
		expect( getDaemonStatus ).toHaveBeenCalledOnce();
	} );

	it( 'returns "not running" when no daemon is present', async () => {
		const { getDaemonStatus } = await import( 'cli/remote-session/daemon' );
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
	it( 'invokes startDaemon with explicit execPath and cliEntry overrides', async () => {
		// REGRESSION GUARD: From Electron main, the defaults `process.execPath` and
		// `process.argv[1]` resolve to the Electron binary and Studio's bundled
		// entry — neither is the CLI. The handler must override both, otherwise
		// "Start" silently spawns the Electron app as the daemon.
		const { startDaemon } = await import( 'cli/remote-session/daemon' );
		vi.mocked( startDaemon ).mockResolvedValue( {
			pid: 99,
			pidFile: '/tmp/remote-session.pid',
		} );

		const { startRemoteSessionDaemon } = await import( 'src/ipc-handlers' );
		await startRemoteSessionDaemon( mockIpcEvent );

		expect( startDaemon ).toHaveBeenCalledOnce();
		expect( startDaemon ).toHaveBeenCalledWith( {
			execPath: '/mock/node/binary',
			cliEntry: '/mock/cli/path',
			// REGRESSION GUARD #2: the CLI gates the entire `code remote-session`
			// subcommand tree behind `STUDIO_ENABLE_REMOTE_SESSION=true`. Without
			// passing it through to the spawned child, the daemon fails with
			// "Unknown arguments: remote-session, start" and times out.
			env: { STUDIO_ENABLE_REMOTE_SESSION: 'true' },
		} );
	} );

	it( 'returns the daemon start result on success', async () => {
		const { startDaemon } = await import( 'cli/remote-session/daemon' );
		vi.mocked( startDaemon ).mockResolvedValue( {
			pid: 42,
			pidFile: '/tmp/remote-session.pid',
		} );

		const { startRemoteSessionDaemon } = await import( 'src/ipc-handlers' );
		const result = await startRemoteSessionDaemon( mockIpcEvent );

		expect( result ).toEqual( {
			pid: 42,
			pidFile: '/tmp/remote-session.pid',
		} );
	} );

	it( 'rethrows DaemonAlreadyRunningError so the renderer can present specific copy', async () => {
		const { startDaemon } = await import( 'cli/remote-session/daemon' );
		vi.mocked( startDaemon ).mockRejectedValue( new DaemonAlreadyRunningError( 7777 ) );

		const { startRemoteSessionDaemon } = await import( 'src/ipc-handlers' );
		await expect( startRemoteSessionDaemon( mockIpcEvent ) ).rejects.toBeInstanceOf(
			DaemonAlreadyRunningError
		);
	} );

	it( 'rethrows DaemonStartTimeoutError when the spawn never writes its PID file', async () => {
		const { startDaemon } = await import( 'cli/remote-session/daemon' );
		vi.mocked( startDaemon ).mockRejectedValue( new DaemonStartTimeoutError( 'timed out' ) );

		const { startRemoteSessionDaemon } = await import( 'src/ipc-handlers' );
		await expect( startRemoteSessionDaemon( mockIpcEvent ) ).rejects.toBeInstanceOf(
			DaemonStartTimeoutError
		);
	} );
} );

describe( 'stopRemoteSessionDaemon', () => {
	it( 'delegates to stopDaemon and passes the result through', async () => {
		const { stopDaemon } = await import( 'cli/remote-session/daemon' );
		vi.mocked( stopDaemon ).mockResolvedValue( {
			stopped: true,
			pid: 12345,
		} );

		const { stopRemoteSessionDaemon } = await import( 'src/ipc-handlers' );
		const result = await stopRemoteSessionDaemon( mockIpcEvent );

		expect( stopDaemon ).toHaveBeenCalledOnce();
		expect( result ).toEqual( { stopped: true, pid: 12345 } );
	} );

	it( 'returns "already stopped" without raising when no daemon was running', async () => {
		const { stopDaemon } = await import( 'cli/remote-session/daemon' );
		vi.mocked( stopDaemon ).mockResolvedValue( {
			stopped: true,
			alreadyStopped: true,
		} );

		const { stopRemoteSessionDaemon } = await import( 'src/ipc-handlers' );
		const result = await stopRemoteSessionDaemon( mockIpcEvent );

		expect( result ).toEqual( { stopped: true, alreadyStopped: true } );
	} );
} );
