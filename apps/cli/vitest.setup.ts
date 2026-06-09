import nock from 'nock';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';

( global as typeof global & { COMMIT_HASH: string } ).COMMIT_HASH = 'mock-hash';

const originalConsoleLog = console.log;
let savedProcessSend: typeof process.send;

beforeEach( () => {
	console.log = vi.fn();

	// Force standalone (non-IPC) mode for each test. The `forks` test pool gives
	// every worker a live `process.send` IPC channel, which would make CLI code
	// that branches on `process.send` (e.g. the logger and the import/export
	// commands) behave as if running as the desktop app's IPC child. Clearing it
	// keeps the pre-forks test environment; restored in afterEach so the pool can
	// still report results. See AINFRA-2475.
	savedProcessSend = process.send;
	process.send = undefined;
} );

nock.disableNetConnect();
nock.enableNetConnect( 'raw.githubusercontent.com' );

afterEach( () => {
	console.log = originalConsoleLog;
	process.send = savedProcessSend;
	nock.cleanAll();
	try {
		vi.useRealTimers();
	} catch {
		// Ignore if real timers are already in use
	}
	vi.clearAllMocks();
} );

afterAll( () => {
	nock.enableNetConnect();
	nock.restore();
} );

vi.mock( 'lockfile', () => {
	const lock = vi.fn( ( file, options, callback ) => callback( null ) );
	const unlock = vi.fn( ( file, callback ) => callback( null ) );
	return {
		default: {
			lock,
			unlock,
		},
		lock,
		unlock,
	};
} );

vi.mock( 'picospinner', () => {
	class MockSpinner {
		start = vi.fn().mockReturnThis();
		stop = vi.fn().mockReturnThis();
		succeed = vi.fn().mockReturnThis();
		fail = vi.fn().mockReturnThis();
		warn = vi.fn().mockReturnThis();
		info = vi.fn().mockReturnThis();
		setText = vi.fn().mockReturnThis();
		refresh = vi.fn().mockReturnThis();
		running = false;
	}
	return {
		Spinner: MockSpinner,
	};
} );
