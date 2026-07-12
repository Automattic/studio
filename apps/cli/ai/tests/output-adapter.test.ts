import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { JsonAdapter } from 'cli/ai/output-adapter';
import { notifyTerminal } from 'cli/lib/notify';
import { PRIVACY_POLICY_URL, TOS_URL } from 'cli/lib/tos-notice';

vi.mock( 'cli/lib/notify', () => ( {
	notifyTerminal: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'JsonAdapter IPC messaging', () => {
	let originalSend: typeof process.send;
	let listeners: Array< ( message: unknown ) => void >;
	let originalOn: typeof process.on;
	let originalOff: typeof process.off;

	beforeEach( () => {
		listeners = [];
		originalSend = process.send;
		originalOn = process.on.bind( process );
		originalOff = process.off.bind( process );

		( process as unknown as { send: typeof process.send } ).send = ( () =>
			true ) as typeof process.send;

		process.on = ( ( event: string, listener: ( message: unknown ) => void ) => {
			if ( event === 'message' ) {
				listeners.push( listener );
				return process;
			}
			return originalOn( event as never, listener as never );
		} ) as typeof process.on;

		process.off = ( ( event: string, listener: ( message: unknown ) => void ) => {
			if ( event === 'message' ) {
				listeners = listeners.filter( ( l ) => l !== listener );
				return process;
			}
			return originalOff( event as never, listener as never );
		} ) as typeof process.off;
	} );

	afterEach( () => {
		( process as unknown as { send: typeof process.send } ).send = originalSend;
		process.on = originalOn;
		process.off = originalOff;
	} );

	it( 'calls onInterrupt when the parent sends an interrupt message', () => {
		const adapter = new JsonAdapter();
		const onInterrupt = vi.fn();
		adapter.onInterrupt = onInterrupt;

		adapter.start();

		expect( listeners ).toHaveLength( 1 );
		listeners[ 0 ]( { type: 'interrupt' } );

		expect( onInterrupt ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'ignores unrelated IPC messages', () => {
		const adapter = new JsonAdapter();
		const onInterrupt = vi.fn();
		adapter.onInterrupt = onInterrupt;

		adapter.start();

		listeners[ 0 ]( { type: 'answer', answers: { foo: 'bar' } } );
		listeners[ 0 ]( 'some-string' );
		listeners[ 0 ]( null );
		listeners[ 0 ]( { type: 'something-else' } );

		expect( onInterrupt ).not.toHaveBeenCalled();
	} );

	it( 'does nothing when onInterrupt is not set', () => {
		const adapter = new JsonAdapter();
		adapter.start();

		expect( () => listeners[ 0 ]( { type: 'interrupt' } ) ).not.toThrow();
	} );

	it( 'removes the IPC listener on stop', () => {
		const adapter = new JsonAdapter();
		adapter.onInterrupt = vi.fn();

		adapter.start();
		expect( listeners ).toHaveLength( 1 );

		adapter.stop();
		expect( listeners ).toHaveLength( 0 );
	} );

	it( 'does not install a listener when not running under a parent IPC channel', () => {
		( process as unknown as { send: typeof process.send } ).send =
			undefined as unknown as typeof process.send;

		const adapter = new JsonAdapter();
		adapter.onInterrupt = vi.fn();

		adapter.start();

		expect( listeners ).toHaveLength( 0 );
	} );
} );

describe( 'JsonAdapter showTosNotice', () => {
	let stderrWriteSpy: MockInstance;
	let stdoutWriteSpy: MockInstance;

	beforeEach( () => {
		stderrWriteSpy = vi.spyOn( process.stderr, 'write' ).mockImplementation( () => true );
		stdoutWriteSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
	} );

	afterEach( () => {
		stderrWriteSpy.mockRestore();
		stdoutWriteSpy.mockRestore();
	} );

	it( 'writes the notice with both URLs to stderr, keeping stdout clean', () => {
		new JsonAdapter().showTosNotice();

		expect( stderrWriteSpy ).toHaveBeenCalledTimes( 1 );
		const output = String( stderrWriteSpy.mock.calls[ 0 ][ 0 ] );
		expect( output ).toContain( TOS_URL );
		expect( output ).toContain( PRIVACY_POLICY_URL );
		expect( stdoutWriteSpy ).not.toHaveBeenCalled();
	} );
} );

describe( 'JsonAdapter terminal notifications', () => {
	const originalSend = process.send;

	beforeEach( () => {
		vi.mocked( notifyTerminal ).mockClear();
	} );

	afterEach( () => {
		( process as unknown as { send: typeof process.send } ).send = originalSend;
	} );

	it( 'notifies "response is ready" on a successful turn', () => {
		new JsonAdapter().emitTurnCompleted( 'success', 'session-1' );
		expect( notifyTerminal ).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining( 'response is ready' )
		);
	} );

	it( 'notifies "waiting for your answer" on a paused turn', () => {
		new JsonAdapter().emitTurnCompleted( 'paused', 'session-1' );
		expect( notifyTerminal ).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining( 'waiting for your answer' )
		);
	} );

	it.each( [ 'error', 'max_turns' ] as const )( 'does not notify on a %s turn', ( status ) => {
		new JsonAdapter().emitTurnCompleted( status, 'session-1' );
		expect( notifyTerminal ).not.toHaveBeenCalled();
	} );

	it( 'notifies exactly once when askUser pauses a standalone (non-IPC) session', async () => {
		( process as unknown as { send: typeof process.send } ).send =
			undefined as unknown as typeof process.send;

		const adapter = new JsonAdapter();
		adapter.onBeforeExit = vi.fn().mockResolvedValue( undefined );
		// askUser() never resolves in standalone mode (process.exitCode is set
		// instead); don't await it, just let the microtasks up to that point run.
		void adapter.askUser( [ { question: 'q', options: [] } ] );
		await Promise.resolve();
		await Promise.resolve();

		// Regression guard: askUser() used to fire its own "waiting for your
		// answer" notification AND emitTurnCompleted('paused', ...) fired a
		// second, identical one - a double OS notification/bell for one event.
		expect( notifyTerminal ).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining( 'waiting for your answer' )
		);
	} );
} );
