import { describe, expect, it } from 'vitest';
import { rewriteNotes } from 'cli/ai/file-rewrites';

const FILE = '/sites/a/wp-content/themes/t/theme.json';

describe( 'rewriteNotes', () => {
	it.each< { case: string; written: string; now: string; notes: string[] } >( [
		{ case: 'an unchanged file', written: 'a\nb', now: 'a\nb', notes: [] },
		{
			case: 'a changed line between kept ones',
			written: 'a\n"src": "https://fonts/x.woff2"\nc',
			now: 'a\n"src": "file:./assets/fonts/x.woff2"\nc',
			notes: [
				`Studio changed ${ FILE } after the write; lines 2-2 now read:\n~~~\n"src": "file:./assets/fonts/x.woff2"\n~~~`,
			],
		},
		{
			case: 'lines added at the end',
			written: 'a\nb',
			now: 'a\nb\nc\nd',
			notes: [ `Studio changed ${ FILE } after the write; lines 3-4 now read:\n~~~\nc\nd\n~~~` ],
		},
		{
			case: 'the first line changed',
			written: 'a\nb',
			now: 'z\nb',
			notes: [ `Studio changed ${ FILE } after the write; lines 1-1 now read:\n~~~\nz\n~~~` ],
		},
		{
			case: 'removed lines',
			written: 'a\nb\nc\nd',
			now: 'a\nd',
			notes: [
				`Studio removed lines 2-3 of ${ FILE } as written; the file now reads differently from the text the agent wrote.`,
			],
		},
		{
			case: 'a repeated line kept at both ends',
			written: 'x\nx',
			now: 'x\nx\nx',
			notes: [ `Studio changed ${ FILE } after the write; lines 3-3 now read:\n~~~\nx\n~~~` ],
		},
		{
			case: 'more lines than a note quotes',
			written: 'a',
			now: Array( 41 ).fill( 'b' ).join( '\n' ),
			notes: [
				`Studio changed lines 1-41 of ${ FILE } after the write, so the file now reads differently from the text the agent wrote. Read those lines before editing them.`,
			],
		},
		{
			case: 'as many lines as a note quotes',
			written: 'a',
			now: Array( 40 ).fill( 'b' ).join( '\n' ),
			notes: [
				`Studio changed ${ FILE } after the write; lines 1-40 now read:\n~~~\n${ Array( 40 )
					.fill( 'b' )
					.join( '\n' ) }\n~~~`,
			],
		},
	] )( 'states $case', ( { written, now, notes } ) => {
		expect( rewriteNotes( FILE, written, now ) ).toEqual( notes );
	} );
} );
