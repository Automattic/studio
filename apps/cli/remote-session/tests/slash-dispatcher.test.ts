import { describe, expect, it } from 'vitest';
import { AI_CHAT_SLASH_COMMANDS } from 'cli/ai/slash-commands';

describe( 'slash dispatcher match shape (regression)', () => {
	// Mirror the dispatcher logic in apps/cli/commands/ai/index.ts so a breaking change
	// shows up here as well as in the REPL. Keep this in sync with the match code.
	const match = ( input: string ) => {
		const trimmed = input.trim();
		const firstToken = trimmed.split( /\s+/, 1 )[ 0 ] ?? '';
		if ( ! firstToken.startsWith( '/' ) ) {
			return undefined;
		}
		return AI_CHAT_SLASH_COMMANDS.find( ( c ) => `/${ c.name }` === firstToken );
	};

	it( 'matches existing no-arg commands exactly as before', () => {
		expect( match( '/clear' )?.name ).toBe( 'clear' );
		expect( match( '/login' )?.name ).toBe( 'login' );
		expect( match( '/exit' )?.name ).toBe( 'exit' );
	} );

	it( 'matches commands with a single trailing argument', () => {
		expect( match( '/remote-session status' )?.name ).toBe( 'remote-session' );
		expect( match( '/remote-session attach' )?.name ).toBe( 'remote-session' );
	} );

	it( 'does not match non-slash input', () => {
		expect( match( 'hello' ) ).toBeUndefined();
		expect( match( 'do /something' ) ).toBeUndefined();
	} );

	it( 'does not falsely match prefixes', () => {
		expect( match( '/remote-sessio' ) ).toBeUndefined();
		expect( match( '/remote-sessions' ) ).toBeUndefined();
	} );
} );
