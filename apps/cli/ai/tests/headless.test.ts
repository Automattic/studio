import { vi } from 'vitest';
import { emitEvent, parseCommand } from 'cli/ai/headless';
import type { HeadlessCommand, HeadlessEvent } from 'cli/ai/headless-types';

describe( 'headless protocol', () => {
	describe( 'emitEvent', () => {
		it( 'writes JSON followed by newline to stdout', () => {
			const writeSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
			const event: HeadlessEvent = {
				type: 'ready',
				providers: [ 'anthropic-api-key' ],
				model: 'claude-sonnet-4-6',
			};
			emitEvent( event );
			expect( writeSpy ).toHaveBeenCalledWith( JSON.stringify( event ) + '\n' );
			writeSpy.mockRestore();
		} );

		it( 'writes error events correctly', () => {
			const writeSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
			const event: HeadlessEvent = {
				type: 'error',
				message: 'Something went wrong',
				code: 'TEST_ERROR',
			};
			emitEvent( event );
			const written = writeSpy.mock.calls[ 0 ][ 0 ] as string;
			const parsed = JSON.parse( written.trim() );
			expect( parsed ).toEqual( event );
			writeSpy.mockRestore();
		} );

		it( 'writes text_delta events', () => {
			const writeSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
			const event: HeadlessEvent = { type: 'text_delta', text: 'Hello world' };
			emitEvent( event );
			expect( writeSpy ).toHaveBeenCalledWith( JSON.stringify( event ) + '\n' );
			writeSpy.mockRestore();
		} );

		it( 'writes tool_use_start events', () => {
			const writeSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
			const event: HeadlessEvent = {
				type: 'tool_use_start',
				id: 'tool_1',
				name: 'Read',
				input: { file_path: '/test.txt' },
			};
			emitEvent( event );
			expect( writeSpy ).toHaveBeenCalledWith( JSON.stringify( event ) + '\n' );
			writeSpy.mockRestore();
		} );

		it( 'writes turn_complete events', () => {
			const writeSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
			const event: HeadlessEvent = {
				type: 'turn_complete',
				turnCount: 5,
				cost: 0.0123,
				sessionId: 'session_abc',
			};
			emitEvent( event );
			expect( writeSpy ).toHaveBeenCalledWith( JSON.stringify( event ) + '\n' );
			writeSpy.mockRestore();
		} );
	} );

	describe( 'parseCommand', () => {
		it( 'parses valid JSON command', () => {
			const cmd: HeadlessCommand = { type: 'message', text: 'hello' };
			expect( parseCommand( JSON.stringify( cmd ) ) ).toEqual( cmd );
		} );

		it( 'parses permission_response command', () => {
			const cmd: HeadlessCommand = { type: 'permission_response', id: 'perm_1', allowed: true };
			expect( parseCommand( JSON.stringify( cmd ) ) ).toEqual( cmd );
		} );

		it( 'parses cancel command', () => {
			const cmd: HeadlessCommand = { type: 'cancel' };
			expect( parseCommand( JSON.stringify( cmd ) ) ).toEqual( cmd );
		} );

		it( 'parses slash_command', () => {
			const cmd: HeadlessCommand = {
				type: 'slash_command',
				command: 'browser',
				args: '--verbose',
			};
			expect( parseCommand( JSON.stringify( cmd ) ) ).toEqual( cmd );
		} );

		it( 'returns null for invalid JSON', () => {
			expect( parseCommand( 'not json' ) ).toBeNull();
		} );

		it( 'returns null for empty line', () => {
			expect( parseCommand( '' ) ).toBeNull();
		} );

		it( 'returns null for whitespace-only line', () => {
			expect( parseCommand( '   ' ) ).toBeNull();
		} );

		it( 'trims whitespace before parsing', () => {
			const cmd: HeadlessCommand = { type: 'message', text: 'hello' };
			expect( parseCommand( `  ${ JSON.stringify( cmd ) }  ` ) ).toEqual( cmd );
		} );

		it( 'returns null for valid JSON with unknown type', () => {
			expect( parseCommand( '{"type":"bogus"}' ) ).toBeNull();
		} );

		it( 'returns null for valid JSON without type field', () => {
			expect( parseCommand( '{"foo":"bar"}' ) ).toBeNull();
		} );
	} );
} );
