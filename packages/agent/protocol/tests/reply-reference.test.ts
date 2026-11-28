import { describe, expect, it } from 'vitest';
import {
	formatReplyPrompt,
	validateReplyReference,
	getMessagePreview,
} from '@studio/agent/protocol/reply-reference';
describe( 'reply references', () => {
	it( 'carries a quoted passage separately from the user instruction', () => {
		const reference = {
			sessionId: 'session',
			entryId: 'message',
			excerpt: 'First line\nSecond line',
		};
		expect( validateReplyReference( reference ) ).toEqual( reference );
		expect( formatReplyPrompt( 'Make it warmer', reference ) ).toContain(
			'> First line\n> Second line\n\nMake it warmer'
		);
	} );
	it( 'keeps older prompts compatible and rejects malformed references at the transport boundary', () => {
		expect( validateReplyReference( undefined ) ).toBeUndefined();
		expect( formatReplyPrompt( 'Hello' ) ).toBe( 'Hello' );
		expect( () =>
			validateReplyReference( { sessionId: 'session', entryId: 'message', excerpt: 42 } )
		).toThrow( 'Invalid reply' );
		expect( () =>
			validateReplyReference( {
				sessionId: 'session',
				entryId: 'message',
				excerpt: 'a'.repeat( 4001 ),
			} )
		).toThrow( 'Invalid reply' );
	} );
} );

it( 'shows readable references without changing their source Markdown', () => {
	const source =
		'## A warmer welcome\n\nUse a **coral palette** and [book a table](https://example.com).';
	expect( getMessagePreview( source ) ).toBe(
		'A warmer welcome Use a coral palette and book a table.'
	);
	expect(
		formatReplyPrompt( 'Continue', { sessionId: 'a', entryId: 'b', excerpt: source } )
	).toContain( '**coral palette**' );
} );
