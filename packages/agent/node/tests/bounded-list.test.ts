import { expect, it } from 'vitest';
import { boundedLines, boundedText } from '@studio/agent/shared/bounded-list';

const items = ( count: number ) => Array.from( { length: count }, ( _, i ) => `i${ i }` );

it.each( [
	{ count: 2, text: 'i0, i1', lines: [ 'i0', 'i1' ] },
	{ count: 3, text: 'i0, i1, i2', lines: [ 'i0', 'i1', 'i2' ] },
	{ count: 5, text: 'i0, i1, i2, and 2 more', lines: [ 'i0', 'i1', 'i2', '…and 2 more' ] },
] )( 'states at most 3 of $count items, then how many more', ( { count, text, lines } ) => {
	expect( boundedText( items( count ), 3 ) ).toBe( text );
	expect( boundedLines( items( count ), 3 ) ).toEqual( lines );
} );
