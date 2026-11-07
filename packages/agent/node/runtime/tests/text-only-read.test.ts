import fs from 'fs';
import os from 'os';
import path from 'path';
import { createReadTool } from '@earendil-works/pi-coding-agent';
import { expect, it } from 'vitest';
import { TEXT_ONLY_IMAGE_NOTE, withTextOnlyImages } from '../text-only-read';

const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'text-only-read-' ) );
// A 1x1 PNG.
fs.writeFileSync(
	path.join( dir, 'pixel.png' ),
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64'
	)
);
fs.writeFileSync( path.join( dir, 'notes.txt' ), 'plain text' );

const read = withTextOnlyImages( createReadTool( dir ) );
const parts = async ( file: string ) =>
	( await read.execute( 'call', { path: path.join( dir, file ) }, new AbortController().signal ) )
		.content;

it.each( [
	{ file: 'pixel.png', types: [ 'text', 'text' ], note: true },
	{ file: 'notes.txt', types: [ 'text' ], note: false },
] )(
	'reads $file with $types for a model that cannot view images',
	async ( { file, types, note } ) => {
		const content = await parts( file );

		expect( content.map( ( part ) => part.type ) ).toEqual( types );
		expect(
			content.some( ( part ) => part.type === 'text' && part.text === TEXT_ONLY_IMAGE_NOTE )
		).toBe( note );
	}
);
