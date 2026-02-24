import { isInteractive } from 'cli/lib/is-interactive';

describe( 'isInteractive', () => {
	const originalIsTTY = process.stdin.isTTY;

	afterEach( () => {
		Object.defineProperty( process.stdin, 'isTTY', {
			value: originalIsTTY,
			writable: true,
			configurable: true,
		} );
	} );

	it( 'returns true when stdin is a TTY', () => {
		Object.defineProperty( process.stdin, 'isTTY', {
			value: true,
			writable: true,
			configurable: true,
		} );
		expect( isInteractive() ).toBe( true );
	} );

	it( 'returns false when stdin is not a TTY', () => {
		Object.defineProperty( process.stdin, 'isTTY', {
			value: false,
			writable: true,
			configurable: true,
		} );
		expect( isInteractive() ).toBe( false );
	} );

	it( 'returns false when isTTY is undefined', () => {
		Object.defineProperty( process.stdin, 'isTTY', {
			value: undefined,
			writable: true,
			configurable: true,
		} );
		expect( isInteractive() ).toBe( false );
	} );
} );
