import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTakeScreenshotTool } from 'cli/ai/tools/take-screenshot';

vi.mock( 'cli/ai/tools/screenshot-helpers', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/tools/screenshot-helpers') >() ),
	captureScreenshotBuffer: async ( _url: string, viewport: unknown, options: unknown ) => {
		captureOptions.push( options as { fullPage: boolean } );
		return {
			buffer: Buffer.from( 'jpeg' ),
			mimeType: 'image/jpeg',
			documentHeight: 900,
			contentHeight: 3200,
			capturedHeight: 900,
			offset: 0,
			clipped: false,
			textFit: [ "p.tagline: its text starts at the viewport's left edge (x 0)." ],
		};
	},
	saveScreenshotFile: async () => ( {
		path: '/tmp/desktop.jpg',
		fileUrl: 'file:///tmp/desktop.jpg',
	} ),
} ) );

const captureOptions: Array< { fullPage: boolean } > = [];
beforeEach( () => {
	captureOptions.length = 0;
} );

const text = async ( result: { content: Array< { type: string; text?: string } > } ) =>
	result.content.map( ( block ) => ( block.type === 'text' ? block.text : '' ) ).join( '\n' );

describe( 'take_screenshot', () => {
	it.each( [
		{ args: {}, fullPage: false, says: 'captured the first screen (1040x900) of a 3200px page' },
		{ args: { fullPage: true }, fullPage: true, says: 'captured full page' },
		{ args: { offset: 900 }, fullPage: true, says: 'captured full page' },
	] )( 'captures $args as fullPage $fullPage', async ( { args, fullPage, says } ) => {
		const tool = createTakeScreenshotTool( { visionEnabled: false } );
		const result = await tool.rawHandler( { url: 'http://localhost:8881', ...args } );

		expect( captureOptions.map( ( options ) => options.fullPage ) ).toEqual( [ fullPage ] );
		expect( await text( result ) ).toContain( says );
	} );

	it.each( [
		{ display: undefined, shown: false },
		{ display: false, shown: false },
		{ display: true, shown: true },
	] )(
		'shows the user the capture when display is $display: $shown',
		async ( { display, shown } ) => {
			const tool = createTakeScreenshotTool( { visionEnabled: false } );
			const result = await tool.rawHandler( { url: 'http://localhost:8881', display } );

			expect( Boolean( result.studioArtifacts ) ).toBe( shown );
		}
	);

	it( 'states where the text does not fit, to a model that views the capture too', async () => {
		const tool = createTakeScreenshotTool( { visionEnabled: true } );
		const result = await tool.rawHandler( { url: 'http://localhost:8881' } );

		expect( await text( result ) ).toContain(
			"\n  Text the browser does not fit:\n    p.tagline: its text starts at the viewport's left edge (x 0)."
		);
	} );

	it( 'hands back image lines for the reply when the host shows linked images', async () => {
		const tool = createTakeScreenshotTool( {
			visionEnabled: false,
			imageLink: ( file ) => `file://${ file }`,
		} );
		const lines = async ( display?: boolean ) =>
			text( await tool.rawHandler( { url: 'http://localhost:8881', display } ) );

		expect( await lines( true ) ).toContain( '![Screenshot (desktop)](file:///tmp/desktop.jpg)' );
		expect( await lines() ).not.toContain( '![' );
	} );
} );
