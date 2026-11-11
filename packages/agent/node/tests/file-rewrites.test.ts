import { rewriteJson } from '@studio/common/lib/json-text';
import { describe, expect, it } from 'vitest';
import { closestLines, rewriteNotes, rewriteReport } from '@studio/agent/node/file-rewrites';

const FILE = '/sites/a/wp-content/themes/t/theme.json';
const AS_WRITTEN = `Studio changed ${ FILE } after the write; every other line reads as written.`;
const lines = ( from: number, to: number, prefix = 'f' ) =>
	Array.from( { length: to - from + 1 }, ( _, i ) => `${ prefix }${ from + i }` );
const quote = ( from: number, quoted: string[] ) =>
	`Lines ${ from }-${ from + quoted.length - 1 } now read:\n~~~\n${ quoted.join( '\n' ) }\n~~~`;
// Every `step`th line of `written` changed.
const changedEvery = ( written: string[], step: number ) =>
	written.map( ( line, i ) => ( i % step === step - 1 ? `${ line }!` : line ) );
// A font family as the agent wrote it, and as Studio's font download left it:
// its Google Fonts key dropped and its fontFace declared (site-file-guards.ts).
const family = { fontFamily: 'Fraunces, serif', name: 'Display', slug: 'display' };
const fontsWritten =
	JSON.stringify(
		{ settings: { typography: { fontFamilies: [ { ...family, google: 'family=Fraunces' } ] } } },
		null,
		'\t'
	) + '\n';
const fontFace = [ 'latin-ext', 'latin' ].map( ( subset ) => ( {
	fontFamily: 'Fraunces',
	src: [ `file:./assets/fonts/fraunces/fraunces-${ subset }.woff2` ],
	unicodeRange: 'U+0100-02BA',
} ) );
// With its family name quoted, as Studio quotes one (quoteFontFamilies()).
const fontsNow = rewriteJson( fontsWritten, {
	settings: {
		typography: {
			fontFamilies: [ { ...family, fontFamily: '"Fraunces", serif', fontFace } ],
		},
	},
} );

describe( 'rewriteNotes', () => {
	it.each< { case: string; written: string; now: string; notes: string[]; whole?: boolean } >( [
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
			case: 'long runs a line apart, as one quote',
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
					quote( 2, [
						'"name": "Inter",',
						...lines( 1, 20 ),
						'b',
						'"name": "Lora",',
						...lines( 1, 20, 'g' ),
					] ),
				].join( '\n' ),
			],
		},
		{
			// eval30: a template part saved through the block editor, 23 runs of its lines.
			case: 'many runs, every one quoted',
			written: lines( 1, 90, 'a' ).join( '\n' ),
			now: changedEvery( lines( 1, 90, 'a' ), 2 ).join( '\n' ),
			notes: [
				[ AS_WRITTEN, quote( 2, changedEvery( lines( 1, 90, 'a' ), 2 ).slice( 1 ) ) ].join( '\n' ),
			],
		},
		{
			case: 'runs more than three lines apart, each quoted',
			written: lines( 1, 12, 'a' ).join( '\n' ),
			now: changedEvery( lines( 1, 12, 'a' ), 5 ).join( '\n' ),
			notes: [ [ AS_WRITTEN, quote( 5, [ 'a5!' ] ), quote( 10, [ 'a10!' ] ) ].join( '\n' ) ],
		},
		{
			case: 'lines gone between quoted lines, in the quote, and apart from them, in order',
			written: [ 'a', 'b', 'c', 'x', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l' ].join( '\n' ),
			now: [ 'a', 'B', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j', 'l' ].join( '\n' ),
			notes: [
				[ AS_WRITTEN, quote( 2, [ 'B', 'c', 'd', 'E' ] ), 'Lines 12-12 as written are gone.' ].join(
					'\n'
				),
			],
		},
		{
			case: 'more changed lines than a note quotes, past which it names them',
			written: lines( 1, 300, 'a' ).join( '\n' ),
			now: lines( 1, 300, 'a' )
				.map( ( line, i ) => ( Math.floor( i / 50 ) % 2 ? line : `${ line }!` ) )
				.join( '\n' ),
			notes: [
				[
					AS_WRITTEN,
					quote(
						1,
						lines( 1, 50, 'a' ).map( ( line ) => `${ line }!` )
					),
					quote(
						101,
						lines( 101, 150, 'a' ).map( ( line ) => `${ line }!` )
					),
					'Lines 201-250 are not quoted here: Read them before editing them.',
				].join( '\n' ),
			],
			whole: false,
		},
		{
			case: 'longer changed lines than a note quotes, past which it names them',
			written: 'a\nb\nc\nd\ne\nf\ng',
			now: [ 'a', 'x'.repeat( 4000 ), 'c', 'd', 'e', 'f', 'y'.repeat( 4000 ) ].join( '\n' ),
			notes: [
				[
					AS_WRITTEN,
					quote( 2, [ 'x'.repeat( 4000 ) ] ),
					'Lines 7-7 are not quoted here: Read them before editing them.',
				].join( '\n' ),
			],
			whole: false,
		},
		{
			case: 'a JSON member Studio added by its lines, beside a value it changed, quoted',
			written: fontsWritten,
			now: fontsNow,
			notes: [
				[
					AS_WRITTEN,
					quote( 6, [
						'\t\t\t\t\t"fontFamily": "\\"Fraunces\\", serif",',
						'\t\t\t\t\t"name": "Display",',
						'\t\t\t\t\t"slug": "display",',
					] ),
					'Lines 9-24 are not quoted here: Read them before editing them.',
				].join( '\n' ),
			],
			whole: false,
		},
	] )( 'states $case', ( { written, now, notes, whole = true } ) => {
		expect( rewriteNotes( FILE, written, now ) ).toEqual( notes );
		expect( rewriteReport( FILE, written, now ).whole ).toBe( whole );
	} );
} );

describe( 'closestLines', () => {
	const file = [
		'<!-- wp:group -->',
		'<div class="wp-block-group">',
		'<!-- wp:paragraph {"fontSize":"size-1-2-rem"} -->',
		'<p class="has-size-1-2-rem-font-size">Visit us</p>',
		'<!-- /wp:paragraph -->',
		'</div>',
		'<!-- /wp:group -->',
		'<!-- wp:spacer -->',
		'<div style="height:40px" class="wp-block-spacer"></div>',
		'<!-- /wp:spacer -->',
	];
	it.each< { case: string; text: string; span: { from: number; to: number } | undefined } >( [
		{
			// As the block editor stores a value a preset has as the preset.
			case: 'lines Studio saved with a preset',
			text: '<!-- wp:paragraph {"style":{"typography":{"fontSize":"1.2rem"}}} -->\n<p style="font-size:1.2rem">Visit us</p>',
			span: { from: 0, to: 6 },
		},
		{
			case: 'a line indented otherwise',
			text: '\t<div style="height:40px" class="wp-block-spacer"></div>',
			span: { from: 6, to: 10 },
		},
		{ case: 'text like no line', text: 'unrelated words entirely', span: undefined },
	] )( 'finds $case', ( { text, span } ) => {
		expect( closestLines( file, text ) ).toEqual( span );
	} );
} );
