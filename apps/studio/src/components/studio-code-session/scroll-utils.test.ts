import { describe, expect, it } from 'vitest';
import { isScrolledToBottom } from './scroll-utils';

describe( 'isScrolledToBottom', () => {
	it( 'returns true when exactly at the bottom', () => {
		expect( isScrolledToBottom( { scrollHeight: 1000, scrollTop: 800, clientHeight: 200 } ) ).toBe(
			true
		);
	} );

	it( 'returns true when within the threshold of the bottom', () => {
		// 20px remaining, default threshold is 32px.
		expect( isScrolledToBottom( { scrollHeight: 1000, scrollTop: 780, clientHeight: 200 } ) ).toBe(
			true
		);
	} );

	it( 'returns false when scrolled up beyond the threshold', () => {
		// 200px remaining, well beyond the 32px threshold.
		expect( isScrolledToBottom( { scrollHeight: 1000, scrollTop: 600, clientHeight: 200 } ) ).toBe(
			false
		);
	} );

	it( 'treats the threshold boundary as not-at-bottom (strict less-than)', () => {
		// Exactly 32px remaining equals the threshold, so it is not "< threshold".
		expect(
			isScrolledToBottom( { scrollHeight: 1000, scrollTop: 768, clientHeight: 200 }, 32 )
		).toBe( false );
		// One pixel inside the boundary is at-bottom.
		expect(
			isScrolledToBottom( { scrollHeight: 1000, scrollTop: 769, clientHeight: 200 }, 32 )
		).toBe( true );
	} );

	it( 'honors a custom threshold', () => {
		expect(
			isScrolledToBottom( { scrollHeight: 1000, scrollTop: 700, clientHeight: 200 }, 150 )
		).toBe( true );
		expect(
			isScrolledToBottom( { scrollHeight: 1000, scrollTop: 700, clientHeight: 200 }, 50 )
		).toBe( false );
	} );
} );
