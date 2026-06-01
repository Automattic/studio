/**
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAppOn = vi.fn();
const mockAppOff = vi.fn();
vi.mock( 'electron', () => ( {
	app: { on: mockAppOn, off: mockAppOff },
} ) );
vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
} ) );
vi.mock( 'src/storage/paths', () => ( {
	getCliPath: () => '/mock/cli/path',
	getBundledNodeBinaryPath: () => '/mock/node/path',
} ) );

const mockSendIpcEventToRenderer = vi.fn();
vi.mock( 'src/ipc-utils', () => ( {
	sendIpcEventToRenderer: ( ...args: unknown[] ) => mockSendIpcEventToRenderer( ...args ),
} ) );

const mockFork = vi.fn();
vi.mock( 'node:child_process', () => ( {
	fork: ( ...args: unknown[] ) => mockFork( ...args ),
} ) );

// A fake ChildProcess: an EventEmitter with the IPC surface the module uses.
class FakeChild extends EventEmitter {
	connected = true;
	killed = false;
	send = vi.fn();
	kill = vi.fn( ( _signal?: string ) => {
		this.killed = true;
		return true;
	} );
}

function newChild(): FakeChild {
	const child = new FakeChild();
	mockFork.mockReturnValueOnce( child );
	return child;
}

async function loadModule() {
	vi.resetModules();
	return import( '../studio-code-process' );
}

beforeEach( () => {
	vi.clearAllMocks();
	vi.useFakeTimers();
} );

afterEach( () => {
	vi.useRealTimers();
} );

describe( 'spawnTurn', () => {
	it( 'forks the CLI with the ipc channel, wasm flag, and base args', async () => {
		const child = newChild();
		const { spawnTurn } = await loadModule();

		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );

		expect( child ).toBeDefined();
		expect( mockFork ).toHaveBeenCalledTimes( 1 );
		const [ cliPath, args, opts ] = mockFork.mock.calls[ 0 ];
		expect( cliPath ).toBe( '/mock/cli/path' );
		expect( args ).toEqual( [
			'code',
			'hello',
			'--json',
			'--path',
			'/sites/one',
			'--site-name',
			'One',
		] );
		expect( opts ).toMatchObject( {
			stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ],
			execPath: '/mock/node/path',
			execArgv: [ '--experimental-wasm-jspi' ],
		} );
	} );

	it( 'forwards CLI envelope messages to the renderer and captures sessionId for resume', async () => {
		const child = newChild();
		const { spawnTurn } = await loadModule();

		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );

		// Non-envelope (Logger) messages are ignored.
		child.emit( 'message', { action: 'foo', status: 'inprogress' } );
		child.emit( 'message', null );
		expect( mockSendIpcEventToRenderer ).not.toHaveBeenCalled();

		const event = { type: 'turn.started', timestamp: 't' };
		child.emit( 'message', event );
		expect( mockSendIpcEventToRenderer ).toHaveBeenCalledWith( 'studio-code-event', {
			siteId: 'site-1',
			event,
		} );

		// turn.completed with a sessionId is captured for the next turn's resume.
		child.emit( 'message', {
			type: 'turn.completed',
			timestamp: 't',
			sessionId: 'sess-123',
			status: 'success',
		} );

		const child2 = newChild();
		spawnTurn( 'site-1', '/sites/one', 'One', 'again' );
		const args2 = mockFork.mock.calls[ 1 ][ 1 ] as string[];
		expect( args2 ).toContain( '--resume-session' );
		expect( args2 ).toContain( 'sess-123' );
		expect( child2 ).toBeDefined();
	} );

	it( 'passes an explicit resumeSessionId through', async () => {
		newChild();
		const { spawnTurn } = await loadModule();
		spawnTurn( 'site-1', '/sites/one', 'One', 'hi', { resumeSessionId: 'explicit-id' } );
		const args = mockFork.mock.calls[ 0 ][ 1 ] as string[];
		expect( args.slice( -2 ) ).toEqual( [ '--resume-session', 'explicit-id' ] );
	} );
} );

describe( 'abortTurn', () => {
	it( 'sends a graceful interrupt over IPC, never SIGTERM', async () => {
		const child = newChild();
		const { spawnTurn, abortTurn } = await loadModule();
		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );

		abortTurn( 'site-1' );

		expect( child.send ).toHaveBeenCalledWith( { type: 'interrupt' } );
		expect( child.kill ).not.toHaveBeenCalled();
	} );

	it( 'force-kills with SIGKILL after the grace period if still alive', async () => {
		const child = newChild();
		const { spawnTurn, abortTurn } = await loadModule();
		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );

		abortTurn( 'site-1' );
		vi.advanceTimersByTime( 2000 );

		expect( child.kill ).toHaveBeenCalledWith( 'SIGKILL' );
	} );

	it( 'escalates straight to SIGKILL on a second abort', async () => {
		const child = newChild();
		const { spawnTurn, abortTurn } = await loadModule();
		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );

		abortTurn( 'site-1' );
		abortTurn( 'site-1' );

		expect( child.kill ).toHaveBeenCalledWith( 'SIGKILL' );
	} );

	it( 'force-kills immediately when the child is disconnected', async () => {
		const child = newChild();
		const { spawnTurn, abortTurn } = await loadModule();
		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );
		child.connected = false;

		abortTurn( 'site-1' );

		expect( child.send ).not.toHaveBeenCalled();
		expect( child.kill ).toHaveBeenCalledWith( 'SIGKILL' );
	} );

	it( 'does not throw for an unknown siteId', async () => {
		const { abortTurn } = await loadModule();
		expect( () => abortTurn( 'nonexistent-site' ) ).not.toThrow();
	} );
} );

describe( 'answerTurn', () => {
	it( 'delivers the answer to the live child over IPC', async () => {
		const child = newChild();
		const { spawnTurn, answerTurn } = await loadModule();
		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );

		answerTurn( 'site-1', { 'Allow read?': 'Allow' } );

		expect( child.send ).toHaveBeenCalledWith( {
			type: 'answer',
			answers: { 'Allow read?': 'Allow' },
		} );
	} );

	it( 'is a no-op when the child is disconnected or missing', async () => {
		const child = newChild();
		const { spawnTurn, answerTurn } = await loadModule();
		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );
		child.connected = false;

		expect( () => answerTurn( 'site-1', { q: 'a' } ) ).not.toThrow();
		expect( () => answerTurn( 'unknown', { q: 'a' } ) ).not.toThrow();
		expect( child.send ).not.toHaveBeenCalled();
	} );
} );

describe( 'stopAllProcesses', () => {
	it( 'does not throw when no processes exist', async () => {
		const { stopAllProcesses } = await loadModule();
		expect( () => stopAllProcesses() ).not.toThrow();
	} );

	it( 'force-kills every active turn', async () => {
		const child = newChild();
		const { spawnTurn, stopAllProcesses } = await loadModule();
		spawnTurn( 'site-1', '/sites/one', 'One', 'hello' );

		stopAllProcesses();

		expect( child.kill ).toHaveBeenCalledWith( 'SIGKILL' );
	} );
} );
