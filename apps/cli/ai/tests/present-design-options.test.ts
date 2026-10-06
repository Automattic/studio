import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createPresentDesignOptionsTool } from 'cli/ai/tools/present-design-options';

vi.mock( 'cli/ai/screenshot-storage', () => ( {
	resolveScreenshotDirectory: async () => os.tmpdir(),
} ) );
vi.mock( 'cli/ai/tools/screenshot-helpers', () => ( {
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

const textOf = (
	result: Awaited<
		ReturnType< ReturnType< typeof createPresentDesignOptionsTool >[ 'rawHandler' ] >
	>
) => result.content.map( ( block ) => ( block.type === 'text' ? block.text : '' ) ).join( '\n' );

describe( 'present_design_options', () => {
	it( 'hands the options back as a numbered grid when it cannot ask the user', async () => {
		const result = await createPresentDesignOptionsTool().rawHandler( args );

		expect( result.content[ 0 ] ).toMatchObject( { type: 'image', mimeType: 'image/jpeg' } );
		expect( textOf( result ) ).toContain(
			'![Which layout should I build?](/tmp/design-options.jpg)'
		);
		expect( textOf( result ) ).toContain( '2. Collage: Overlapping photos.' );
		expect( result.structuredContent ).toBeUndefined();
	} );

	it( 'gives a picker the previews and tells the agent to end its turn', async () => {
		const result = await createPresentDesignOptionsTool( { picker: true } ).rawHandler( args );

		expect( textOf( result ) ).toContain( 'end your turn now' );
		expect( result.structuredContent ).toEqual( {
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
