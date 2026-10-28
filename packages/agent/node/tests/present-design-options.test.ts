import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { bindTool, type ToolResult } from '@studio/agent/shared/tools/define-tool';
import { createPresentDesignOptionsTool } from '@studio/agent/shared/tools/present-design-options';
import { createFakeHost } from './fake-host';

vi.mock( '@studio/agent/node/screenshot-storage', () => ( {
	resolveScreenshotDirectory: async () => os.tmpdir(),
} ) );
vi.mock( '@studio/agent/shared/tools/screenshot-helpers', () => ( {
	captureScreenshotBuffer: async () => ( { buffer: Buffer.from( 'jpeg' ), contentHeight: 900 } ),
	saveScreenshotFile: async () => ( { path: '/tmp/design-options.jpg' } ),
} ) );

const args = {
	catalog: 'layouts' as const,
	question: 'Which layout should I build?',
	options: [
		{ label: 'Broadsheet', description: 'Newspaper columns.', preview: '<p>A</p>' },
		{ label: 'Collage', description: 'Overlapping photos.', preview: '<p>B</p>' },
	],
};

const presentDesignOptions = (
	options?: Parameters< typeof createPresentDesignOptionsTool >[ 0 ]
) => bindTool( createPresentDesignOptionsTool( options ), createFakeHost() );

const textOf = ( result: ToolResult ) =>
	result.content.map( ( block ) => ( block.type === 'text' ? block.text : '' ) ).join( '\n' );

describe( 'present_design_options', () => {
	it( 'hands the options back as a numbered grid when it cannot ask the user', async () => {
		const result = await presentDesignOptions().rawHandler( args );

		expect( result.content[ 0 ] ).toMatchObject( { type: 'image', mimeType: 'image/jpeg' } );
		expect( textOf( result ) ).toContain(
			'![Which layout should I build?](/tmp/design-options.jpg)'
		);
		expect( textOf( result ) ).toContain( '2. Collage: Overlapping photos.' );
		expect( result._meta ).toBeUndefined();
	} );

	it( 'gives a picker the previews and tells the agent to end its turn', async () => {
		const result = await presentDesignOptions( { picker: true } ).rawHandler( args );

		expect( textOf( result ) ).toContain( 'end your turn now' );
		expect( result._meta ).toEqual( {
			question: 'Which layout should I build?',
			options: [
				expect.objectContaining( {
					label: 'Broadsheet',
					image: expect.stringMatching( /^data:image\/jpeg;base64,/ ),
				} ),
				expect.objectContaining( { label: 'Collage' } ),
			],
		} );
	} );
} );
