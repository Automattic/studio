import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { createTakeScreenshotTool } from '@studio/agent/node/tools/take-screenshot';

vi.mock( '@studio/agent/node/tools/screenshot-helpers', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/agent/node/tools/screenshot-helpers') >() ),
	captureScreenshotBuffer: async (
		url: string,
		viewport: { width: number },
		options: { fullPage: boolean }
	) => {
		captureOptions.push( options );
		captured.push( `${ url } ${ viewport.width }` );
		return {
			// As page.url() reports it: the URL as the browser parsed it, after any redirect.
			url: new URL( url.replace( /\/checkout\/$/, '/cart/' ) ).href,
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
const captured: string[] = [];
beforeEach( () => {
	captureOptions.length = 0;
	captured.length = 0;
} );

const text = async ( result: { content: Array< { type: string; text?: string } > } ) =>
	result.content.map( ( block ) => ( block.type === 'text' ? block.text : '' ) ).join( '\n' );

describe( 'take_screenshot', () => {
	it.each( [
		{ args: {}, fullPage: false, says: 'captured the first screen (1040x900) of a 3200px page' },
		{ args: { fullPage: true }, fullPage: true, says: 'captured full page' },
		{ args: { offset: 900 }, fullPage: true, says: 'captured full page' },
	] )( 'captures $args as fullPage $fullPage', async ( { args, fullPage, says } ) => {
		const tool = bindTool( createTakeScreenshotTool( { visionEnabled: false } ), createFakeHost() );
		const result = await tool.rawHandler( {
			url: 'http://localhost:8881',
			viewport: 'desktop',
			...args,
		} );

		expect( captureOptions.map( ( options ) => options.fullPage ) ).toEqual( [ fullPage ] );
		expect( await text( result ) ).toContain( says );
	} );

	it.each( [
		[ 'http://localhost:8881/checkout/', true ],
		[ 'http://localhost:8881', false ],
	] )( 'names the page rendered for %s only after a redirect', async ( url, redirected ) => {
		const tool = bindTool( createTakeScreenshotTool( { visionEnabled: false } ), createFakeHost() );
		expect(
			( await text( await tool.rawHandler( { url, viewport: 'desktop' } ) ) ).includes(
				'after redirect'
			)
		).toBe( redirected );
	} );

	it( 'captures every page it is given at desktop and mobile in one call', async () => {
		const tool = bindTool( createTakeScreenshotTool( { visionEnabled: true } ), createFakeHost() );
		const result = await tool.rawHandler( {
			url: [ 'http://localhost:8881/', 'http://localhost:8881/about/' ],
		} );

		expect( captured ).toEqual( [
			'http://localhost:8881/ 1040',
			'http://localhost:8881/ 390',
			'http://localhost:8881/about/ 1040',
			'http://localhost:8881/about/ 390',
		] );
		expect( result.content.filter( ( block ) => block.type === 'image' ) ).toHaveLength( 4 );
		expect( await text( result ) ).toContain(
			'- http://localhost:8881/about/ mobile: captured the first screen'
		);
	} );

	it.each( [
		{ display: undefined, shown: false },
		{ display: false, shown: false },
		{ display: true, shown: true },
	] )(
		'shows the user the capture when display is $display: $shown',
		async ( { display, shown } ) => {
			const tool = bindTool(
				createTakeScreenshotTool( { visionEnabled: false } ),
				createFakeHost()
			);
			const result = await tool.rawHandler( { url: 'http://localhost:8881', display } );

			expect( Boolean( result.studioArtifacts ) ).toBe( shown );
		}
	);

	it( 'states where the text does not fit, to a model that views the capture too', async () => {
		const tool = bindTool( createTakeScreenshotTool( { visionEnabled: true } ), createFakeHost() );
		const result = await tool.rawHandler( { url: 'http://localhost:8881' } );

		expect( await text( result ) ).toContain(
			"\n  Text the browser does not fit:\n    p.tagline: its text starts at the viewport's left edge (x 0)."
		);
	} );

	it( 'hands back image lines for the reply when the host shows linked images', async () => {
		const tool = bindTool(
			createTakeScreenshotTool( {
				visionEnabled: false,
				imageLink: ( file ) => `file://${ file }`,
			} ),
			createFakeHost()
		);
		const lines = async ( display?: boolean ) =>
			text( await tool.rawHandler( { url: 'http://localhost:8881', display } ) );

		expect( await lines( true ) ).toContain( '![Screenshot (desktop)](file:///tmp/desktop.jpg)' );
		expect( await lines() ).not.toContain( '![' );
	} );
} );
