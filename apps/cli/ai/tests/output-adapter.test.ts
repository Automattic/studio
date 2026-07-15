import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { JsonAdapter } from 'cli/ai/output-adapter';
import { PRIVACY_POLICY_URL, TOS_URL } from 'cli/lib/tos-notice';

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

	it( 'forwards steer messages to onSteer and reports the delivery result', async () => {
		const sendSpy = vi.fn( () => true );
		( process as unknown as { send: typeof process.send } ).send =
			sendSpy as unknown as typeof process.send;

		const adapter = new JsonAdapter();
		const onSteer = vi.fn().mockResolvedValue( true );
		adapter.onSteer = onSteer;

		adapter.start();
		listeners[ 0 ]( { type: 'steer', text: 'make the hero darker' } );

		await vi.waitFor( () =>
			expect( sendSpy ).toHaveBeenCalledWith(
				expect.objectContaining( {
					type: 'steer.result',
					delivered: true,
					text: 'make the hero darker',
				} )
			)
		);
		expect( onSteer ).toHaveBeenCalledWith( 'make the hero darker' );
	} );

	it( 'reports steer messages as undelivered when no turn is live', async () => {
		const sendSpy = vi.fn( () => true );
		( process as unknown as { send: typeof process.send } ).send =
			sendSpy as unknown as typeof process.send;

		const adapter = new JsonAdapter();
		adapter.start();

		listeners[ 0 ]( { type: 'steer', text: 'too late' } );

		await vi.waitFor( () =>
			expect( sendSpy ).toHaveBeenCalledWith(
				expect.objectContaining( { type: 'steer.result', delivered: false, text: 'too late' } )
			)
		);
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
