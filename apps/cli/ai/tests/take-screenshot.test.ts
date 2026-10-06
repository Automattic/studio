import { describe, expect, it, vi } from 'vitest';
import { createTakeScreenshotTool } from 'cli/ai/tools/take-screenshot';

vi.mock( 'cli/ai/tools/screenshot-helpers', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/tools/screenshot-helpers') >() ),
	captureScreenshotBuffer: async () => ( {
		buffer: Buffer.from( 'jpeg' ),
		mimeType: 'image/jpeg',
		documentHeight: 900,
		offset: 0,
	} ),
	saveScreenshotFile: async () => ( {
		path: '/tmp/desktop.jpg',
		fileUrl: 'file:///tmp/desktop.jpg',
	} ),
} ) );

describe( 'take_screenshot', () => {
	it( 'hands back image lines for the reply when the host shows linked images', async () => {
		const tool = createTakeScreenshotTool( {
			visionEnabled: false,
			imageLink: ( file ) => `file://${ file }`,
		} );
		const text = async ( display?: boolean ) =>
			( await tool.rawHandler( { url: 'http://localhost:8881', display } ) ).content
				.map( ( block ) => ( block.type === 'text' ? block.text : '' ) )
				.join( '\n' );

		expect( await text() ).toContain( '![Screenshot (desktop)](file:///tmp/desktop.jpg)' );
		expect( await text( false ) ).not.toContain( '![' );
	} );
} );
