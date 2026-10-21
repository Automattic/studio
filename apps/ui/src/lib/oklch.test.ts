import { describe, expect, it } from 'vitest';
import { hexToOklch, oklchToHex } from './oklch';

describe( 'oklch', () => {
	it( 'round-trips sRGB colors', () => {
		for ( const hex of [ '#3858e9', '#069e08', '#fafafa', '#141414' ] ) {
			expect( oklchToHex( hexToOklch( hex ) ) ).toBe( hex );
		}
	} );

	it( 'reads white as full lightness without chroma', () => {
		const white = hexToOklch( '#ffffff' );
		expect( white.l ).toBeCloseTo( 1, 3 );
		expect( white.c ).toBeCloseTo( 0, 3 );
	} );
} );
