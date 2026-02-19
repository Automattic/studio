import nock from 'nock';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';

( global as typeof global & { COMMIT_HASH: string } ).COMMIT_HASH = 'mock-hash';

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

vi.mock( 'ora', () => {
	const mockOra = () => ( {
		start: vi.fn().mockReturnThis(),
		stop: vi.fn().mockReturnThis(),
		succeed: vi.fn().mockReturnThis(),
		fail: vi.fn().mockReturnThis(),
		warn: vi.fn().mockReturnThis(),
		info: vi.fn().mockReturnThis(),
		text: '',
		isSpinning: false,
	} );
	return {
		default: mockOra,
	};
} );
