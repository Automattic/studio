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

describe( 'JsonAdapter handleEvent error surfacing', () => {
	let originalSend: typeof process.send;
	let emitted: Array< { type: string; message?: string } >;

	beforeEach( () => {
		emitted = [];
		originalSend = process.send;
		( process as unknown as { send: typeof process.send } ).send = ( ( event: unknown ) => {
			emitted.push( event as { type: string; message?: string } );
			return true;
		} ) as typeof process.send;
	} );

	afterEach( () => {
		( process as unknown as { send: typeof process.send } ).send = originalSend;
	} );

	const buildAgentEnd = ( overrides: {
		stopReason?: string;
		errorMessage?: string;
		text?: string;
	} ) =>
		( {
			type: 'agent_end',
			messages: [
				{
					role: 'assistant',
					content: overrides.text ? [ { type: 'text', text: overrides.text } ] : [],
					stopReason: overrides.stopReason ?? 'stop',
					errorMessage: overrides.errorMessage,
				},
			],
		} ) as unknown as Parameters< JsonAdapter[ 'handleEvent' ] >[ 0 ];

	it( 'emits an error event when an agent_end turn errored, using the errorMessage', () => {
		new JsonAdapter().handleEvent(
			buildAgentEnd( { stopReason: 'error', errorMessage: 'API Error: 500 internal server error' } )
		);

		const errorEvent = emitted.find( ( e ) => e.type === 'error' );
		expect( errorEvent ).toBeDefined();
		expect( errorEvent?.message ).toBe( 'API Error: 500 internal server error' );
	} );

	it( 'falls back to a generic message when the errored turn carries no reason', () => {
		new JsonAdapter().handleEvent( buildAgentEnd( { stopReason: 'error' } ) );

		const errorEvent = emitted.find( ( e ) => e.type === 'error' );
		expect( errorEvent ).toBeDefined();
		expect( errorEvent?.message ).toMatch( /error/i );
	} );

	it( 'does not emit an error event for a successful agent_end', () => {
		new JsonAdapter().handleEvent( buildAgentEnd( { stopReason: 'stop', text: 'Done!' } ) );

		expect( emitted.some( ( e ) => e.type === 'error' ) ).toBe( false );
	} );

	it( 'does not emit an error event when the turn was interrupted', () => {
		new JsonAdapter().handleEvent( buildAgentEnd( { stopReason: 'aborted' } ) );

		expect( emitted.some( ( e ) => e.type === 'error' ) ).toBe( false );
	} );
} );
