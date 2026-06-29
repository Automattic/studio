/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { getAiPatchLineMap } from './monaco-highlighting';
import { buildDiffHunks } from './utils';

describe( 'project workbench Monaco patch highlighting', () => {
	it( 'maps saved-change additions to after-side line numbers', () => {
		const beforeContent = [ 'one', 'two', 'three' ].join( '\n' );
		const afterContent = [ 'one', 'two', '', '', 'TWO', 'three' ].join( '\n' );
		const hunks = buildDiffHunks( beforeContent, afterContent, 1 );

		expect( [ ...getAiPatchLineMap( hunks, 'after' ).entries() ] ).toEqual( [
			[ 3, { type: 'add' } ],
			[ 4, { type: 'add' } ],
			[ 5, { type: 'add' } ],
		] );
	} );

	it( 'maps unapplied AI proposals to before-side deletion lines only', () => {
		const beforeContent = [ 'one', 'two', 'three' ].join( '\n' );
		const afterContent = [ 'one', 'TWO', 'three', 'four' ].join( '\n' );
		const hunks = buildDiffHunks( beforeContent, afterContent, 1 );

		expect( [ ...getAiPatchLineMap( hunks, 'before' ).entries() ] ).toEqual( [
			[ 2, { type: 'delete' } ],
		] );
	} );
} );
