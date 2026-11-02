import { describe, expect, it } from 'vitest';
import { rewriteNotes } from '@studio/agent/node/file-rewrites';

const FILE = '/sites/a/wp-content/themes/t/theme.json';
const AS_WRITTEN = `Studio changed ${ FILE } after the write; every other line reads as written.`;
const lines = ( from: number, to: number, prefix = 'f' ) =>
	Array.from( { length: to - from + 1 }, ( _, i ) => `${ prefix }${ from + i }` );

describe( 'rewriteNotes', () => {
	it.each< { case: string; written: string; now: string; notes: string[] } >( [
		{ case: 'an unchanged file', written: 'a\nb', now: 'a\nb', notes: [] },
		{
			case: 'a changed line between kept ones',
			written: 'a\n"src": "https://fonts/x.woff2"\nc',
			now: 'a\n"src": "file:./assets/fonts/x.woff2"\nc',
			notes: [
				`${ AS_WRITTEN }\nLines 2-2 now read:\n~~~\n"src": "file:./assets/fonts/x.woff2"\n~~~`,
			],
		},
		{
			case: 'removed lines',
			written: 'a\nb\nc\nd',
			now: 'a\nd',
			notes: [ `${ AS_WRITTEN }\nLines 2-3 as written are gone.` ],
		},
		{
			// As Studio declares each font family's files after the line naming it.
			case: 'long runs between kept lines',
			written: 'a\n"name": "Inter"\nb\n"name": "Lora"\nc',
			now: [
				'a',
				'"name": "Inter",',
				...lines( 1, 20 ),
				'b',
				'"name": "Lora",',
				...lines( 1, 20, 'g' ),
				'c',
			].join( '\n' ),
			notes: [
				[
					AS_WRITTEN,
					'Lines 2-4 now read:\n~~~\n"name": "Inter",\nf1\nf2\n~~~',
					'Lines 5-19 are not quoted here: Read them before editing them.',
					'Lines 20-22 now read:\n~~~\nf18\nf19\nf20\n~~~',
					'Lines 24-26 now read:\n~~~\n"name": "Lora",\ng1\ng2\n~~~',
					'Lines 27-41 are not quoted here: Read them before editing them.',
					'Lines 42-44 now read:\n~~~\ng18\ng19\ng20\n~~~',
				].join( '\n' ),
			],
		},
		{
			case: 'more runs than a note quotes',
			written: lines( 1, 90, 'a' ).join( '\n' ),
			now: lines( 1, 90, 'a' )
				.map( ( line, i ) => ( i % 2 ? `${ line }!` : line ) )
				.join( '\n' ),
			notes: [
				`Studio changed 45 runs of lines in ${ FILE } after the write, so the file now reads differently from the text the agent wrote. Read it before editing it.`,
			],
		},
	] )( 'states $case', ( { written, now, notes } ) => {
		expect( rewriteNotes( FILE, written, now ) ).toEqual( notes );
	} );
} );
