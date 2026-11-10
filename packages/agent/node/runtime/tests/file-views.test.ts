import fs from 'fs';
import os from 'os';
import path from 'path';
import { rewriteJson } from '@studio/common/lib/json-text';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileViews } from '../file-views';
import { getEditedTexts } from '../tool-safety';

const paragraph = ( attributes: string, tag: string ) =>
	`<!-- wp:paragraph ${ attributes } -->\n${ tag }Visit us</p>\n<!-- /wp:paragraph -->`;
// A template part as the agent wrote it, and as Studio saved it through the
// block editor with the font size preset it made of the value it repeats.
const PART = [
	'<!-- wp:group {"layout":{"type":"constrained"}} -->',
	'<div class="wp-block-group">',
	paragraph( '{"style":{"typography":{"fontSize":"1.2rem"}}}', '<p style="font-size:1.2rem">' ),
	'</div>',
	'<!-- /wp:group -->',
].join( '\n' );
const PART_SAVED = PART.replace(
	paragraph( '{"style":{"typography":{"fontSize":"1.2rem"}}}', '<p style="font-size:1.2rem">' ),
	paragraph( '{"fontSize":"size-1-2-rem"}', '<p class="has-size-1-2-rem-font-size">' )
);
const THEME_JSON = `{
	"version": 3,
	"settings": {
		"typography": {
			"fontSizes": [
				{ "slug": "small", "size": "0.9rem", "name": "Small" }
			]
		}
	}
}
`;
// As Studio adds a preset to theme.json (addPresets() in repeated-style-values.ts).
const withPreset = ( written: string ) => {
	const json = JSON.parse( written );
	json.settings.typography.fontSizes.push( {
		name: '1.2rem',
		slug: 'size-1-2-rem',
		size: '1.2rem',
	} );
	return rewriteJson( written, json );
};

describe( 'FileViews', () => {
	let dir: string;
	beforeEach( () => {
		dir = fs.mkdtempSync( path.join( os.tmpdir(), 'file-views-' ) );
	} );
	afterEach( () => fs.rmSync( dir, { recursive: true, force: true } ) );
	const put = ( name: string, text: string ) => {
		const file = path.join( dir, name );
		fs.writeFileSync( file, text );
		return file;
	};

	// eval30: "Studio saved parts/header.html … through the block editor with
	// those presets" and "it added size-1-5-rem … to theme.json" said no line.
	it.each< { case: string; name: string; written: string; saved: ( text: string ) => string } >( [
		{
			case: 'a template part Studio saved with a preset',
			name: 'footer.html',
			written: PART,
			saved: () => PART_SAVED,
		},
		{
			case: 'a preset Studio added to theme.json',
			name: 'theme.json',
			written: THEME_JSON,
			saved: withPreset,
		},
	] )( 'quotes the lines of $case the agent holds', ( { name, written, saved } ) => {
		const views = new FileViews();
		const file = put( name, written );
		views.saw( file, 'Write', written );
		const held = views.read();
		const now = saved( written );
		fs.writeFileSync( file, now );
		const [ note ] = views.rewritesSince( held, [] );
		const quoted = [ ...note.matchAll( /now read:\n~~~\n([\s\S]*?)\n~~~/g ) ].map(
			( [ , text ] ) => text
		);
		expect( note ).toMatch(
			new RegExp(
				`^Studio changed ${ file } after the write; every other line reads as written\\.`
			)
		);
		expect( note ).not.toContain( 'not quoted' );
		// Each quote is lines the file now holds, in one piece, for an Edit to quote.
		for ( const text of quoted ) {
			expect( now ).toContain( text );
		}
		expect( quoted.join( '\n' ) ).toContain(
			name === 'theme.json' ? '"slug": "size-1-2-rem"' : 'has-size-1-2-rem-font-size'
		);
		// Quoted whole, the agent holds the file as it reads: no change to tell again.
		expect( views.rewritesSince( held, [] ) ).toEqual( [] );
		expect( views.missedEdit( file, now, [ 'not in it' ] ) ).toBeUndefined();
	} );

	it( 'says nothing of a file the call wrote, or the agent does not hold', () => {
		const views = new FileViews();
		const written = put( 'footer.html', PART );
		const unheld = put( 'header.html', PART );
		views.saw( written, 'Write', PART );
		const held = views.read();
		fs.writeFileSync( written, PART_SAVED );
		fs.writeFileSync( unheld, PART_SAVED );
		expect( views.rewritesSince( held, [ written ] ) ).toEqual( [] );
	} );

	it.each< { case: string; wanted: string[]; note: ( file: string ) => string | undefined } >( [
		{
			case: 'where the saved part reads closest to a text it looked for',
			wanted: [ '<p style="font-size:1.2rem">Visit us</p>' ],
			note: ( file ) =>
				[
					`${ file } changed after your Write of it. Where it now reads closest to the text the Edit looked for:`,
					'Lines 2-6 now read:',
					'~~~',
					...PART_SAVED.split( '\n' ).slice( 1, 6 ),
					'~~~',
				].join( '\n' ),
		},
		{
			case: 'nothing of a text the file holds',
			wanted: [ '<div class="wp-block-group">' ],
			note: ( file ) =>
				[
					`${ file } changed after your Write of it; every other line reads as your Write left it.`,
					'Lines 3-4 now read:',
					'~~~',
					...PART_SAVED.split( '\n' ).slice( 2, 4 ),
					'~~~',
				].join( '\n' ),
		},
	] )( 'tells an Edit missing its text $case', ( { wanted, note } ) => {
		const views = new FileViews();
		const file = put( 'footer.html', PART );
		views.saw( file, 'Write', PART );
		fs.writeFileSync( file, PART_SAVED );
		expect( views.missedEdit( file, PART_SAVED, wanted ) ).toBe( note( file ) );
	} );
} );

describe( 'getEditedTexts', () => {
	it.each< [ string, unknown, string[] ] >( [
		[
			'edits',
			{
				edits: [
					{ oldText: 'a', newText: 'b' },
					{ oldText: 'c', newText: 'd' },
				],
			},
			[ 'a', 'c' ],
		],
		[ 'edits as JSON', { edits: JSON.stringify( [ { oldText: 'a', newText: 'b' } ] ) }, [ 'a' ] ],
		[ 'one edit', { edits: { oldText: 'a', newText: 'b' } }, [ 'a' ] ],
		[ 'a legacy edit', { oldText: 'a', newText: 'b' }, [ 'a' ] ],
		[ 'no edit', { edits: 'not json' }, [] ],
	] )( 'takes the texts of %s', ( _case, params, texts ) => {
		expect( getEditedTexts( params ) ).toEqual( texts );
	} );
} );
