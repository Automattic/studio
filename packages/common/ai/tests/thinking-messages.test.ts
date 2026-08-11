import { describe, expect, it } from 'vitest';
import { randomThinkingMessage, THINKING_MESSAGES } from '../thinking-messages';

describe( 'randomThinkingMessage', () => {
	it( 'never repeats the same message twice in a row', () => {
		let previous = randomThinkingMessage();
		// Enough draws to cross several deck reshuffles.
		for ( let i = 0; i < THINKING_MESSAGES.length * 5; i++ ) {
			const next = randomThinkingMessage();
			expect( next ).not.toBe( previous );
			previous = next;
		}
	} );

	it( 'cycles the whole deck before repeating', () => {
		// Any 2N consecutive draws span at least one full deck and at most
		// three partial ones, so every message appears 1–3 times.
		const draws = Array.from( { length: THINKING_MESSAGES.length * 2 }, () =>
			randomThinkingMessage()
		);
		for ( const message of THINKING_MESSAGES ) {
			const count = draws.filter( ( draw ) => draw === message ).length;
			expect( count ).toBeGreaterThanOrEqual( 1 );
			expect( count ).toBeLessThanOrEqual( 3 );
		}
	} );
} );
