import path from 'node:path';
import { createEditTool } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { prepareEditArguments } from '@studio/agent/browser/edit-text';
import { createFileTools } from '@studio/agent/browser/file-tools';
import { bindTool } from '@studio/agent/shared/tools/define-tool';
import type { StudioAgentHost } from '@studio/agent/shared/host';

type Edits = Array< { oldText: string; newText: string } >;

const lines = ( count: number, ending = '\n' ) =>
	Array.from( { length: count }, ( _, index ) => `line ${ index + 1 }` ).join( ending ) + ending;

// pi's own Edit tool, over one in-memory file.
async function piEdit( content: string, edits: Edits ) {
	let written = content;
	const tool = createEditTool( '/', {
		operations: {
			readFile: async () => Buffer.from( written ),
			writeFile: async ( _path, next ) => {
				written = next;
			},
			access: async () => {},
		},
	} );
	try {
		const result = await tool.execute( 'call', { path: '/file.txt', edits } );
		return { written, diff: ( result.details as { diff: string } ).diff };
	} catch ( error ) {
		return { error: ( error as Error ).message };
	}
}

// The browser agent's Edit tool, bound as the agent binds it, over one in-memory file.
async function ourEdit( content: string, edits: Edits ) {
	let written = content;
	const host = {
		sitesRoot: '/',
		path: path.posix,
		files: {
			readText: async () => written,
			write: async ( _path: string, data: string ) => {
				written = data;
			},
		},
	} as unknown as StudioAgentHost;
	const edit = createFileTools( host ).find( ( tool ) => tool.name === 'Edit' )!;
	try {
		const result = await bindTool( edit, host ).execute( 'call', {
			path: '/file.txt',
			edits,
		} as never );
		return { written, diff: ( result.details as { diff: string } ).diff };
	} catch ( error ) {
		return { error: ( error as Error ).message };
	}
}

describe( 'edit-text', () => {
	it.each< [ string, string, Edits ] >( [
		[ 'an exact edit', lines( 30 ), [ { oldText: 'line 12\n', newText: 'line twelve\n' } ] ],
		[
			'disjoint edits',
			lines( 40 ),
			[
				{ oldText: 'line 3\n', newText: 'line three\n' },
				{ oldText: 'line 35\n', newText: '' },
			],
		],
		[
			'a CRLF file with a BOM',
			`\uFEFF${ lines( 8, '\r\n' ) }`,
			[ { oldText: 'line 2\nline 3', newText: 'two' } ],
		],
		[
			'a fuzzy match on smart quotes and trailing spaces',
			'a “quoted” line   \nnext\n',
			[ { oldText: 'a "quoted" line\n', newText: 'a plain line\n' } ],
		],
		[ 'a missing text', lines( 12 ), [ { oldText: 'absent', newText: 'x' } ] ],
		[ 'a duplicated text', lines( 12 ), [ { oldText: 'line 1', newText: 'x' } ] ],
		[
			'overlapping edits',
			lines( 12 ),
			[
				{ oldText: 'line 2\nline 3', newText: 'x' },
				{ oldText: 'line 3\nline 4', newText: 'y' },
			],
		],
	] )( 'edits %s as pi’s Edit tool does', async ( _name, content, edits ) => {
		expect( await ourEdit( content, edits ) ).toEqual( await piEdit( content, edits ) );
	} );

	it( 'accepts edits sent as a JSON string, and a single top-level edit', () => {
		expect(
			prepareEditArguments( { path: 'a', edits: '[{"oldText":"x","newText":"y"}]' } )
		).toEqual( { path: 'a', edits: [ { oldText: 'x', newText: 'y' } ] } );
		expect( prepareEditArguments( { path: 'a', oldText: 'x', newText: 'y' } ) ).toEqual( {
			path: 'a',
			edits: [ { oldText: 'x', newText: 'y' } ],
		} );
	} );
} );
