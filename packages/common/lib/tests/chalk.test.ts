/**
 * @vitest-environment node
 */
// To run tests, execute `npm run test -- common/lib/tests/chalk.test.ts` from the root directory
import chalk from '@studio/common/lib/chalk';

describe( 'chalk wrapper', () => {
	const originalForceColor = process.env.FORCE_COLOR;

	beforeEach( () => {
		// FORCE_COLOR=3 forces 24-bit color for both styleText and getColorDepth,
		// so tests are deterministic regardless of the runner's TTY state.
		process.env.FORCE_COLOR = '3';
	} );

	afterEach( () => {
		if ( originalForceColor === undefined ) {
			delete process.env.FORCE_COLOR;
		} else {
			process.env.FORCE_COLOR = originalForceColor;
		}
	} );

	it( 'applies a single named style', () => {
		expect( chalk.red( 'hi' ) ).toBe( '\x1b[31mhi\x1b[39m' );
	} );

	it( 'chains modifiers and colors', () => {
		expect( chalk.bold.red( 'hi' ) ).toBe( '\x1b[1m\x1b[31mhi\x1b[39m\x1b[22m' );
	} );

	it( 'supports aliased leaves (const b = chalk.bold)', () => {
		const b = chalk.bold;
		expect( b( 'hi' ) ).toBe( chalk.bold( 'hi' ) );
	} );

	it( 'composes with nested calls', () => {
		const composed = chalk.dim( chalk.strikethrough( 'done' ) );
		expect( composed ).toContain( 'done' );
		expect( composed.startsWith( '\x1b[2m' ) ).toBe( true );
	} );

	it( 'emits 24-bit escape for hex foreground', () => {
		expect( chalk.hex( '#8839ef' )( 'x' ) ).toBe( '\x1b[38;2;136;57;239mx\x1b[39m' );
	} );

	it( 'emits 24-bit escape for hex background combined with a named fg', () => {
		const out = chalk.bgHex( '#ddeeff' ).black( 'x' );
		// Named style is applied first, then wrapped in the bg hex escape.
		expect( out ).toBe( '\x1b[48;2;221;238;255m\x1b[30mx\x1b[39m\x1b[49m' );
	} );

	it( 'strips hex escapes when terminal lacks truecolor support', () => {
		// FORCE_COLOR=1 caps color depth at 16 colors, disabling truecolor.
		process.env.FORCE_COLOR = '1';
		expect( chalk.hex( '#8839ef' )( 'x' ) ).toBe( 'x' );
		expect( chalk.bgHex( '#ddeeff' )( 'x' ) ).toBe( 'x' );
	} );
} );
