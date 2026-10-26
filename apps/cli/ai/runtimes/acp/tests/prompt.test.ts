import { describe, expect, it } from 'vitest';
import { readPrompt } from 'cli/ai/runtimes/acp';

describe( 'readPrompt', () => {
	it( 'joins text, links, and embedded text resources into the prompt', () => {
		const { text, images } = readPrompt( [
			{ type: 'text', text: 'Fix the header.' },
			{ type: 'resource_link', name: 'header.php', uri: 'file:///site/header.php' },
			{
				type: 'resource',
				resource: { uri: 'file:///site/style.css', text: 'body { margin: 0; }' },
			},
		] );
		expect( text ).toBe(
			[
				'Fix the header.',
				'[header.php](file:///site/header.php)',
				'<file uri="file:///site/style.css">\nbody { margin: 0; }\n</file>',
			].join( '\n\n' )
		);
		expect( images ).toEqual( [] );
	} );

	it( 'passes supported images through as attachments and drops others', () => {
		const { images } = readPrompt( [
			{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
			{ type: 'image', data: 'AAAA', mimeType: 'image/tiff' },
		] );
		expect( images ).toHaveLength( 1 );
		expect( images[ 0 ] ).toMatchObject( { mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' } );
	} );
} );
