import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonAdapter } from 'cli/ai/output-adapter';

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
