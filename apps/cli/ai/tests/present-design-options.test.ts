import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it, vi } from 'vitest';
import { setScreenshotDirectoryProvider } from 'cli/ai/screenshot-storage';
import { generateImagesTool, withBackgroundGeneration } from 'cli/ai/tools/generate-images';
import { createPresentDesignOptionsTool } from 'cli/ai/tools/present-design-options';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { AnyStudioAgentTool } from 'cli/ai/tools/define-tool';

const rendered = vi.hoisted( () => [] as string[] );

vi.mock( 'cli/lib/site-paths', async () => {
	const { mkdtempSync } = await import( 'node:fs' );
	const { tmpdir } = await import( 'node:os' );
	return { STUDIO_SITES_ROOT: mkdtempSync( `${ tmpdir() }/studio-sites-` ) };
} );

vi.mock( 'cli/ai/tools/screenshot-helpers', () => ( {
	captureScreenshotBuffer: async ( url: string ) => {
		rendered.push( await readFile( fileURLToPath( url ), 'utf8' ) );
		return { buffer: Buffer.alloc( 0 ), contentHeight: 900 };
	},
	saveScreenshotFile: async () => ( { path: '/preview.png' } ),
} ) );

const run = async ( tool: AnyStudioAgentTool, args: object ) => {
	const { content } = await tool.execute( 'call', args as never );
	return content[ 0 ].type === 'text' ? content[ 0 ].text : '';
};

afterAll( async () => {
	setScreenshotDirectoryProvider( null );
	await rm( STUDIO_SITES_ROOT, { recursive: true, force: true } );
} );

it( 'generates images in the background while present_design_options waits for them', async () => {
	setScreenshotDirectoryProvider( () => STUDIO_SITES_ROOT );
	const ready = path.join( STUDIO_SITES_ROOT, 'ready.jpg' );
	const failed = path.join( STUDIO_SITES_ROOT, 'failed.jpg' );
	let finish = () => {};
	const generateImages = withBackgroundGeneration( {
		...generateImagesTool,
		execute: async () => {
			await new Promise< void >( ( resolve ) => ( finish = resolve ) );
			await writeFile( ready, 'jpeg' );
			throw new Error( 'failed.jpg was filtered' );
		},
	} );
	const images = [ ready, failed ].map( ( image ) => ( { path: image, subject: 'A latte' } ) );
	expect( await run( generateImages, { images, background: true } ) ).toBe(
		'Generating the images in the background.'
	);

	const presenting = run(
		createPresentDesignOptionsTool( async ( [ { question } ] ) => ( { [ question ]: 'Noir' } ) ),
		{
			catalog: 'layouts',
			question: 'Which layout?',
			options: [ 'Noir', 'Paper' ].map( ( label ) => ( {
				label,
				description: label,
				preview: `<img src="${ ready }"><img src="${ failed }">`,
			} ) ),
		}
	);
	await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
	expect( rendered ).toEqual( [] );

	finish();
	expect( await presenting ).toBe(
		`The user picked option 1: Noir\n\nThese images are missing and were shown as solid color shapes: ${ failed }. Generate them again or adapt the layout before the build.`
	);
	expect( rendered[ 0 ] ).toContain(
		`src="data:image/jpeg;base64,${ Buffer.from( 'jpeg' ).toString( 'base64' ) }"`
	);
	expect( rendered[ 0 ] ).toContain( 'src="data:image/gif;base64,' );
} );
