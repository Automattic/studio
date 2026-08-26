import nock from 'nock';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';

( global as typeof global & { COMMIT_HASH: string } ).COMMIT_HASH = 'mock-hash';

// CLI telemetry is gated on this build-time flag. Default it off in tests; specs
// that assert telemetry opt in via vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', true ).
( global as typeof global & { __ENABLE_CLI_TELEMETRY__: boolean } ).__ENABLE_CLI_TELEMETRY__ =
	false;

const originalConsoleLog = console.log;

beforeEach( () => {
	console.log = vi.fn();
} );

nock.disableNetConnect();
nock.enableNetConnect( 'raw.githubusercontent.com' );

afterEach( () => {
	console.log = originalConsoleLog;
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
