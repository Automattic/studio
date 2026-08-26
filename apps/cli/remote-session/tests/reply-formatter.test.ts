import { describe, expect, it } from 'vitest';
import { chunkReply, extractReply } from 'cli/remote-session/reply-formatter';

describe( 'extractReply', () => {
	it( 'returns the result text when no questions were asked', () => {
		expect( extractReply( { replyText: 'Hello there!' } ) ).toBe( 'Hello there!' );
	} );

	it( 'returns null when there is nothing to send', () => {
		expect( extractReply( {} ) ).toBeNull();
		expect( extractReply( { replyText: '' } ) ).toBeNull();
	} );

	it( 'prefixes errors with a warning sigil', () => {
		expect( extractReply( { replyText: 'Boom', isError: true } ) ).toBe( '⚠️ Boom' );
	} );

	it( 'strips ANSI escapes from the result text', () => {
		expect( extractReply( { replyText: '[31mred[0m text' } ) ).toBe( 'red text' );
	} );

	it( 'formats a single question with lettered options and an Other hint', () => {
		const out = extractReply( {
			questions: [
				{
					question: 'Pick one',
					options: [
						{ label: 'Yes', description: 'Do it' },
						{ label: 'No', description: 'No' },
					],
				},
			],
		} );
		expect( out ).toContain( '**Pick one**' );
		expect( out ).toContain( '- A) Yes — Do it' );
		// description equal to label is omitted
		expect( out ).toContain( '- B) No\n' );
		expect( out ).toContain( 'Or reply with anything else for "Other"' );
	} );

	it( 'prepends lead-in result text before a question', () => {
		const out = extractReply( {
			replyText: 'Quick clarifier:',
			questions: [
				{
					question: 'A or B?',
					options: [
						{ label: 'A', description: '' },
						{ label: 'B', description: '' },
					],
				},
			],
		} );
		expect( out?.startsWith( 'Quick clarifier:\n\n**A or B?**' ) ).toBe( true );
	} );

	it( 'numbers multiple questions', () => {
		const out = extractReply( {
			questions: [
				{ question: 'Q1', options: [ { label: 'A', description: '' } ] },
				{ question: 'Q2', options: [ { label: 'B', description: '' } ] },
			],
		} );
		expect( out ).toContain( '1. **Q1**' );
		expect( out ).toContain( '2. **Q2**' );
	} );
} );

describe( 'chunkReply', () => {
	it( 'returns the input as a single chunk when under the limit', () => {
		expect( chunkReply( 'small', 100 ) ).toEqual( [ 'small' ] );
	} );

	it( 'splits long plain text on paragraph boundaries first', () => {
		const text = `${ 'a'.repeat( 80 ) }\n\n${ 'b'.repeat( 80 ) }\n\n${ 'c'.repeat( 80 ) }`;
		const chunks = chunkReply( text, 100 );
		expect( chunks.length ).toBeGreaterThanOrEqual( 2 );
		for ( const chunk of chunks ) {
			expect( chunk.length ).toBeLessThanOrEqual( 100 );
		}
	} );

	it( 'never splits a fenced code block mid-block when it fits', () => {
		const code = '```js\nconst x = 1;\n```';
		const before = 'a'.repeat( 60 );
		const text = `${ before }\n\n${ code }`;
		const chunks = chunkReply( text, 80 );
		expect( chunks.some( ( c ) => c.includes( code ) ) ).toBe( true );
	} );

	it( 'splits an oversized fenced block into labeled parts', () => {
		const lines = Array.from( { length: 100 }, ( _, i ) => `line${ i }` ).join( '\n' );
		const code = '```ts\n' + lines + '\n```';
		const chunks = chunkReply( code, 200 );
		expect( chunks.length ).toBeGreaterThan( 1 );
		for ( const chunk of chunks ) {
			expect( chunk.startsWith( '```ts' ) ).toBe( true );
			expect( chunk.endsWith( '```' ) ).toBe( true );
			expect( chunk ).toMatch( /\(part \d+\/\d+\)/ );
		}
	} );
} );
