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

describe( 'present_design_options', () => {
	it( 'hands the options back as a numbered grid when it cannot ask the user', async () => {
		const result = await createPresentDesignOptionsTool().rawHandler( {
			catalog: 'layouts',
			question: 'Which layout should I build?',
			options: [
				{ label: 'Broadsheet', description: 'Newspaper columns.', preview: '<p>A</p>' },
				{ label: 'Collage', description: 'Overlapping photos.', preview: '<p>B</p>' },
			],
		} );

		expect( result.content[ 0 ] ).toMatchObject( { type: 'image', mimeType: 'image/jpeg' } );
		const text = result.content[ 1 ].type === 'text' ? result.content[ 1 ].text : '';
		expect( text ).toContain( '![Which layout should I build?](file:///tmp/design-options.jpg)' );
		expect( text ).toContain( '2. Collage: Overlapping photos.' );
		expect( text ).toContain( 'end your turn' );
	} );
} );
