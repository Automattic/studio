import { describe, expect, it } from 'vitest';
import { conflictsWith, getBlockingOperation } from '../site-operation';

describe( 'conflictsWith', () => {
	it( 'lets two shared operations run together', () => {
		expect( conflictsWith( 'export', 'push' ) ).toBe( false );
	} );

	it( 'blocks anything against an exclusive operation, in either direction', () => {
		expect( conflictsWith( 'import', 'export' ) ).toBe( true );
		expect( conflictsWith( 'export', 'import' ) ).toBe( true );
	} );

	// Settings changes restart the server, so they're exclusive like a start.
	it( 'treats a settings change as exclusive', () => {
		expect( conflictsWith( 'settings', 'export' ) ).toBe( true );
	} );
} );

describe( 'getBlockingOperation', () => {
	it( 'reports nothing for an idle site', () => {
		expect( getBlockingOperation( undefined ) ).toBeNull();
		expect( getBlockingOperation( [] ) ).toBeNull();
	} );

	// The exclusive one is what's actually blocking everything else, so it's
	// what the user needs named — not whichever lease happens to be first.
	it( 'prefers the exclusive operation over a shared one', () => {
		expect(
			getBlockingOperation( [
				{ id: 'a', pid: 1, kind: 'export' },
				{ id: 'b', pid: 2, kind: 'import' },
			] )
		).toBe( 'import' );
	} );

	it( 'falls back to the only operation held', () => {
		expect( getBlockingOperation( [ { id: 'a', pid: 1, kind: 'push' } ] ) ).toBe( 'push' );
	} );
} );
