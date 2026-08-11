import { describe, expect, it } from 'vitest';
import { formatElapsedTime } from './index';

describe( 'formatElapsedTime', () => {
	it( 'shows bare seconds under a minute', () => {
		expect( formatElapsedTime( 0 ) ).toBe( '0s' );
		expect( formatElapsedTime( 12 ) ).toBe( '12s' );
		expect( formatElapsedTime( 59 ) ).toBe( '59s' );
	} );

	it( 'adds minutes with padded seconds', () => {
		expect( formatElapsedTime( 60 ) ).toBe( '1m 00s' );
		expect( formatElapsedTime( 65 ) ).toBe( '1m 05s' );
		expect( formatElapsedTime( 599 ) ).toBe( '9m 59s' );
		expect( formatElapsedTime( 600 ) ).toBe( '10m 00s' );
	} );

	it( 'keeps seconds visible at the hour scale', () => {
		expect( formatElapsedTime( 3600 ) ).toBe( '1h 00m 00s' );
		expect( formatElapsedTime( 3725 ) ).toBe( '1h 02m 05s' );
		expect( formatElapsedTime( 7322 ) ).toBe( '2h 02m 02s' );
	} );
} );
