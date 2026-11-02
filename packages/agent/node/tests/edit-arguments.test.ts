import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { createEditTool } from '@earendil-works/pi-coding-agent';
import { expect, it } from 'vitest';
import { withStringEdits } from '@studio/agent/node/tools/edit-arguments';

// eval6: the model sent `edits` as a JSON string holding theme.json's tabs raw.
it( 'applies edits sent as a JSON string with raw tabs in their texts', async () => {
	const dir = mkdtempSync( path.join( os.tmpdir(), 'edit-' ) );
	const file = path.join( dir, 'theme.json' );
	writeFileSync( file, '{\n\t"color": "red",\n\t"quote": "6\\" \ttall"\n}\n' );
	const tool = withStringEdits( createEditTool( dir ) );
	const call = {
		type: 'toolCall' as const,
		id: '1',
		name: 'edit',
		arguments: tool.prepareArguments!( {
			path: file,
			edits:
				'[{"oldText": "\t\\"color\\": \\"red\\"",\n "newText": "\t\\"color\\": \\"green\\""}, {"oldText": "6\\\\\\" \ttall", "newText": "7\\\\\\" \ttall"}]',
		} ),
	};
	const args = validateToolArguments( tool, call );
	await tool.execute( '1', args );
	expect( readFileSync( file, 'utf8' ) ).toBe(
		'{\n\t"color": "green",\n\t"quote": "7\\" \ttall"\n}\n'
	);
} );
