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

describe( 'JsonAdapter handleEvent', () => {
	let stdoutWriteSpy: MockInstance;
	let originalSend: typeof process.send;

	beforeEach( () => {
		originalSend = process.send;
		( process as unknown as { send: typeof process.send } ).send =
			undefined as unknown as typeof process.send;
		stdoutWriteSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
	} );

	afterEach( () => {
		( process as unknown as { send: typeof process.send } ).send = originalSend;
		stdoutWriteSpy.mockRestore();
	} );

	function emitted(): Array< { type: string; message: Record< string, unknown > } > {
		return stdoutWriteSpy.mock.calls.map( ( call ) => JSON.parse( String( call[ 0 ] ) ) );
	}

	const partial = {
		role: 'assistant',
		content: [
			{ type: 'text', text: 'A long reply so far' },
			{ type: 'toolCall', id: 'call-1', name: 'Write', arguments: { path: 'a.css' } },
		],
	};

	it( 'forwards message_update as its delta, without the partial message', () => {
		const adapter = new JsonAdapter();
		adapter.handleEvent( {
			type: 'message_update',
			message: partial,
			assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' far', partial },
		} as never );
		adapter.handleEvent( {
			type: 'message_update',
			message: partial,
			assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, partial },
		} as never );
		adapter.handleEvent( {
			type: 'message_update',
			message: partial,
			assistantMessageEvent: { type: 'toolcall_end', contentIndex: 1, toolCall: {}, partial },
		} as never );

		expect( emitted().map( ( event ) => event.message ) ).toEqual( [
			{
				type: 'message_update',
				assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' far' },
			},
			{
				type: 'message_update',
				assistantMessageEvent: {
					type: 'toolcall_start',
					contentIndex: 1,
					id: 'call-1',
					name: 'Write',
				},
			},
			{
				type: 'message_update',
				assistantMessageEvent: { type: 'toolcall_end', contentIndex: 1 },
			},
		] );
		expect( stdoutWriteSpy.mock.calls.join( '' ) ).not.toContain( 'A long reply so far' );
	} );

	it( 'drops updates that only repeat the message (start, done, error)', () => {
		const adapter = new JsonAdapter();
		adapter.handleEvent( {
			type: 'message_update',
			message: partial,
			assistantMessageEvent: { type: 'start', partial },
		} as never );
		adapter.handleEvent( {
			type: 'message_update',
			message: partial,
			assistantMessageEvent: { type: 'done', reason: 'stop', message: partial },
		} as never );
		expect( stdoutWriteSpy ).not.toHaveBeenCalled();
	} );

	it( 'still forwards message_end with the full message', () => {
		const adapter = new JsonAdapter();
		adapter.handleEvent( { type: 'message_end', message: partial } as never );
		expect( emitted() ).toEqual( [
			expect.objectContaining( {
				type: 'message',
				message: { type: 'message_end', message: partial },
			} ),
		] );
	} );
} );
