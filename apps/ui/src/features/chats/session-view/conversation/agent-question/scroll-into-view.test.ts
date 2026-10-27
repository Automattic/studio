import { describe, expect, it } from 'vitest';
import { getQuestionScrollDelta } from '@/features/chats/session-view/conversation/agent-question/scroll-into-view';

describe( 'getQuestionScrollDelta', () => {
	// The scroller spans the full column, so its bottom sits *under* the
	// floating composer. `reservedBottomSpace` is the scroller padding holding
	// content clear of the composer plus the column's own trailing space, so a
	// card settles where scrolling to the bottom would put it rather than flush.
	// Column runs 0-800 with a 120px composer and 20px of trailing space.
	const container = { containerTop: 0, containerBottom: 800, reservedBottomSpace: 140 };

	it( 'scrolls a question hidden behind the composer fully clear of it', () => {
		// Card ends at 700, i.e. 40px below the composer's top edge at 660.
		const delta = getQuestionScrollDelta( {
			...container,
			elementTop: 500,
			elementBottom: 700,
		} );

		expect( delta ).toBe( 40 );
		expect( 700 - delta ).toBeLessThanOrEqual( 800 - 140 );
	} );

	it( 'leaves a question that already clears the composer alone', () => {
		expect( getQuestionScrollDelta( { ...container, elementTop: 400, elementBottom: 600 } ) ).toBe(
			0
		);
	} );

	it( 'scrolls up to a question cut off at the top, ignoring the bottom clearance', () => {
		expect( getQuestionScrollDelta( { ...container, elementTop: 4, elementBottom: 300 } ) ).toBe(
			-8
		);
	} );
} );
