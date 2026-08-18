import { describe, expect, it } from 'vitest';
import { formatElapsedTime } from './index';

describe( 'formatElapsedTime', () => {
	it.each( [
		[ 1, '1s' ],
		[ 80, '1m 20s' ],
		[ 908, '15m 8s' ],
		[ 5266, '1h 27m 46s' ],
		[ 3601, '1h 1s' ],
	] )( 'formats %i seconds as %s', ( seconds, expected ) => {
		expect( formatElapsedTime( seconds ) ).toBe( expected );
	} );
} );
