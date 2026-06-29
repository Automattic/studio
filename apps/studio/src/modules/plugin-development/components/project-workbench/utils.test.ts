/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
	applyDiffHunkToContent,
	applyDiffHunksToContent,
	buildDiffHunks,
	createReviewPatchFromContents,
	getDevelopmentChatSessionTitle,
	revertDiffHunkInContent,
} from './utils';
import type { DevelopmentChatMessage } from './types';

function chatMessage(
	id: string,
	role: DevelopmentChatMessage[ 'role' ],
	content: string
): DevelopmentChatMessage {
	return { id, role, content };
}

describe( 'project workbench diff utilities', () => {
	it( 'splits distant changes into separate hunks', () => {
		const beforeContent = [ 'alpha', 'shared one', 'middle', 'shared two', 'omega' ].join( '\n' );
		const afterContent = [ 'ALPHA', 'shared one', 'middle', 'shared two', 'OMEGA' ].join( '\n' );

		const hunks = buildDiffHunks( beforeContent, afterContent, 1 );

		expect( hunks ).toHaveLength( 2 );
		expect( hunks[ 0 ].lines.some( ( line ) => line.content === 'ALPHA' ) ).toBe( true );
		expect( hunks[ 1 ].lines.some( ( line ) => line.content === 'OMEGA' ) ).toBe( true );
	} );

	it( 'applies one hunk without accepting the rest of a proposal', () => {
		const beforeContent = [ 'one', 'two', 'three', 'four', 'five', 'six', 'seven' ].join( '\n' );
		const afterContent = [ 'one', 'TWO', 'three', 'four', 'five', 'six', 'SEVEN' ].join( '\n' );
		const hunks = buildDiffHunks( beforeContent, afterContent, 1 );

		const nextContent = applyDiffHunkToContent( beforeContent, hunks[ 0 ] );

		expect( nextContent ).toBe(
			[ 'one', 'TWO', 'three', 'four', 'five', 'six', 'seven' ].join( '\n' )
		);
		expect( buildDiffHunks( nextContent, afterContent, 1 ) ).toHaveLength( 1 );
	} );

	it( 'rebuilds target content from only the hunks that remain accepted', () => {
		const beforeContent = [ 'one', 'two', 'three', 'four', 'five', 'six', 'seven' ].join( '\n' );
		const afterContent = [ 'one', 'TWO', 'three', 'four', 'five', 'six', 'SEVEN' ].join( '\n' );
		const hunks = buildDiffHunks( beforeContent, afterContent, 1 );

		const nextAfterContent = applyDiffHunksToContent( beforeContent, hunks.slice( 1 ) );

		expect( nextAfterContent ).toBe(
			[ 'one', 'two', 'three', 'four', 'five', 'six', 'SEVEN' ].join( '\n' )
		);
	} );

	it( 'reverts one hunk without reverting the rest of the current file', () => {
		const beforeContent = [ 'one', 'two', 'three', 'four', 'five', 'six', 'seven' ].join( '\n' );
		const afterContent = [ 'one', 'TWO', 'three', 'four', 'five', 'six', 'SEVEN' ].join( '\n' );
		const hunks = buildDiffHunks( beforeContent, afterContent, 1 );

		const nextContent = revertDiffHunkInContent( afterContent, hunks[ 0 ] );

		expect( nextContent ).toBe(
			[ 'one', 'two', 'three', 'four', 'five', 'six', 'SEVEN' ].join( '\n' )
		);
		expect( buildDiffHunks( beforeContent, nextContent, 1 ) ).toHaveLength( 1 );
	} );

	it( 'creates review patch metadata from before and after file contents', () => {
		const patch = createReviewPatchFromContents( {
			filePath: 'plugin.php',
			beforeContent: "<?php\nreturn 'old';\n",
			afterContent: "<?php\nreturn 'new';\n",
			prompt: 'Local saved changes',
		} );

		expect( patch ).toMatchObject( {
			source: 'release',
			path: 'plugin.php',
			status: 'modified',
			beforeContent: "<?php\nreturn 'old';\n",
			afterContent: "<?php\nreturn 'new';\n",
			prompt: 'Local saved changes',
		} );
		expect( patch?.hunks ).toHaveLength( 1 );
		expect( patch?.additions ).toBe( 1 );
		expect( patch?.deletions ).toBe( 1 );
	} );

	it( 'does not create a review patch when contents match', () => {
		expect(
			createReviewPatchFromContents( {
				filePath: 'plugin.php',
				beforeContent: 'same',
				afterContent: 'same',
			} )
		).toBeNull();
	} );

	it( 'creates a compact chat session title from the latest user prompt', () => {
		expect(
			getDevelopmentChatSessionTitle( [
				chatMessage( '1', 'user', 'Explain the release flow' ),
				chatMessage( '2', 'assistant', 'Sure.' ),
				chatMessage( '3', 'user', 'Fix the readme and plugin headers' ),
			] )
		).toBe( 'Fix the readme and plugin headers' );
	} );

	it( 'uses a readable title for the fix plugin command', () => {
		expect(
			getDevelopmentChatSessionTitle( [
				chatMessage( '1', 'user', '/fix-plugin only handle warnings' ),
			] )
		).toBe( 'Fix plugin check issues' );
	} );

	it( 'falls back to Studio Code for empty chat sessions', () => {
		expect( getDevelopmentChatSessionTitle( [] ) ).toBe( 'Studio Code' );
	} );
} );
