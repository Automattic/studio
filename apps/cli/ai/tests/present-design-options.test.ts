import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { setScreenshotDirectoryProvider } from 'cli/ai/screenshot-storage';
import {
	createGenerateImagesTool,
	forgetBackgroundImages,
	settleBackgroundImages,
} from 'cli/ai/tools/generate-images';
import { createPresentDesignOptionsTool } from 'cli/ai/tools/present-design-options';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { GenerateImageResult } from 'cli/ai/image-generation';
import type { AnyStudioAgentTool } from 'cli/ai/tools/define-tool';

const mocks = vi.hoisted( () => ( { generateImages: vi.fn() } ) );

vi.mock( 'cli/lib/site-paths', async () => {
	const [ { mkdtempSync }, { tmpdir }, { join } ] = await Promise.all( [
		import( 'node:fs' ),
		import( 'node:os' ),
		import( 'node:path' ),
	] );
	return { STUDIO_SITES_ROOT: mkdtempSync( join( tmpdir(), 'studio-sites-' ) ) };
} );

vi.mock( 'cli/ai/image-generation', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/ai/image-generation') >() ),
	isImageGenerationAvailable: async () => true,
	generateImages: mocks.generateImages,
} ) );

vi.mock( 'cli/ai/browser-utils', () => ( { getSharedBrowser: vi.fn() } ) );

const JPEG = Buffer.from( [ 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10 ] );
const DRAFT = `---
name: Test
colors:
  primary: "#c2552b"
  background: "#ffffff"
  text: "#111111"
typography:
  display:
    fontFamily: "Fraunces"
    fontWeight: 700
---
## Overview
`;
const sneakPeek = ( image: string ) =>
	`<html><body><img src="${ image }" alt=""><div class="hero"></div></body></html>`;

function deferredGeneration() {
	let resolve: ( results: GenerateImageResult[] ) => void = () => {};
	mocks.generateImages.mockReturnValueOnce(
		new Promise< GenerateImageResult[] >( ( done ) => {
			resolve = done;
		} )
	);
	return { resolve: ( results: GenerateImageResult[] ) => resolve( results ) };
}

const execute = async (
	tool: AnyStudioAgentTool,
	args: Record< string, unknown >,
	onProgress = vi.fn()
) => {
	const { content } = await tool.execute(
		'call-1',
		args as never,
		new AbortController().signal,
		onProgress
	);
	return content[ 0 ].type === 'text' ? content[ 0 ].text : '';
};

describe( 'background image generation', () => {
	const generateImages = createGenerateImagesTool( { background: true } );
	const renderedPreviews: string[] = [];
	const onAskUser = vi.fn( async ( questions: { question: string }[] ) => ( {
		[ questions[ 0 ].question ]: 'Noir',
	} ) );
	const presentDesignOptions = createPresentDesignOptionsTool( onAskUser );
	let imagePath: string;

	beforeEach( async () => {
		renderedPreviews.length = 0;
		imagePath = path.join(
			STUDIO_SITES_ROOT,
			'cafe',
			`image-${ Date.now() }-${ Math.random() }.jpg`
		);
		setScreenshotDirectoryProvider( () => path.join( STUDIO_SITES_ROOT, 'screenshots' ) );
		const page = {
			emulateMedia: vi.fn(),
			goto: vi.fn( async ( url: string ) => {
				renderedPreviews.push( await readFile( fileURLToPath( url ), 'utf8' ) );
			} ),
			waitForLoadState: vi.fn().mockResolvedValue( undefined ),
			evaluate: vi.fn().mockResolvedValue( 900 ),
			addStyleTag: vi.fn(),
			screenshot: vi.fn().mockResolvedValue( Buffer.from( 'png' ) ),
			close: vi.fn(),
		};
		vi.mocked( getSharedBrowser ).mockResolvedValue( { newPage: async () => page } as never );
	} );

	afterAll( async () => {
		setScreenshotDirectoryProvider( null );
		await rm( STUDIO_SITES_ROOT, { recursive: true, force: true } );
	} );

	it( 'returns at once and writes the file when the generation completes', async () => {
		const generation = deferredGeneration();
		const text = await execute( generateImages, {
			images: [ { path: imagePath, subject: 'A latte on a marble counter' } ],
			background: true,
		} );
		expect( text ).toContain( 'in the background' );
		expect( text ).toContain( imagePath );
		await expect( stat( imagePath ) ).rejects.toThrow();

		generation.resolve( [ { ok: true, bytes: JPEG } ] );
		const report = await settleBackgroundImages( [ imagePath ] );
		expect( report.lines ).toEqual( [ `OK ${ imagePath } (0 KB)` ] );
		expect( report.failed.size ).toBe( 0 );
		await expect( readFile( imagePath ) ).resolves.toEqual( JPEG );
		// Reported until a preview delivers it, then forgotten.
		expect( ( await settleBackgroundImages( [ imagePath ] ) ).lines ).toHaveLength( 1 );
		forgetBackgroundImages( [ imagePath ] );
		expect( ( await settleBackgroundImages( [ imagePath ] ) ).lines ).toEqual( [] );
	} );

	it( 'present_design_options waits for a pending image, inlines it and reports the batch', async () => {
		const generation = deferredGeneration();
		await execute( generateImages, {
			images: [ { path: imagePath, subject: 'A latte' } ],
			background: true,
		} );
		const onProgress = vi.fn();
		const presenting = execute(
			presentDesignOptions,
			{
				catalog: 'layouts',
				question: 'Which layout should I build?',
				options: [
					{ label: 'Noir', description: 'Dark.', preview: sneakPeek( imagePath ) },
					{ label: 'Broadsheet', description: 'Columns.', preview: sneakPeek( imagePath ) },
				],
			},
			onProgress
		);
		await vi.waitFor( () =>
			expect( onProgress ).toHaveBeenCalledWith(
				expect.objectContaining( {
					details: { studioProgress: { message: 'Waiting for the images to generate…' } },
				} )
			)
		);
		expect( renderedPreviews ).toHaveLength( 0 );

		generation.resolve( [ { ok: true, bytes: JPEG } ] );
		const text = await presenting;
		expect( text ).toBe(
			`The user picked option 1: Noir\n\nImages generated in the background:\nOK ${ imagePath } (0 KB)`
		);
		expect( renderedPreviews ).toHaveLength( 2 );
		expect( renderedPreviews[ 0 ] ).toContain(
			`src="data:image/jpeg;base64,${ JPEG.toString( 'base64' ) }"`
		);
	} );

	it( 'shows a failed background image as a solid shape and says so', async () => {
		const generation = deferredGeneration();
		await execute( generateImages, {
			images: [ { path: imagePath, subject: 'A latte' } ],
			background: true,
		} );
		generation.resolve( [ { ok: false, error: 'blocked', filtered: true } ] );

		const text = await execute( presentDesignOptions, {
			catalog: 'directions',
			question: 'Which look should I build?',
			options: [
				{ label: 'Noir', description: 'Dark.', preview: DRAFT, image: imagePath },
				{ label: 'Paper', description: 'Light.', preview: sneakPeek( imagePath ) },
			],
		} );
		expect( text ).toContain( `FAILED ${ imagePath }: blocked (safety filter` );
		expect( text ).toContain( 'shown as a solid color shape' );
		// Previews render concurrently, in no fixed order.
		const board = renderedPreviews.find( ( html ) => html.includes( '<h2>Imagery</h2>' ) );
		const peek = renderedPreviews.find( ( html ) => html.startsWith( '<html>' ) );
		expect( board ).toContain( 'class="picture pattern"' );
		expect( peek ).toContain( 'src="data:image/gif;base64,' );
		expect( peek ).not.toContain( imagePath );
	} );

	it( 'keeps the report for the retry when a preview is rejected', async () => {
		const generation = deferredGeneration();
		await execute( generateImages, {
			images: [ { path: imagePath, subject: 'A latte' } ],
			background: true,
		} );
		generation.resolve( [ { ok: false, error: 'blocked' } ] );
		const options = [
			{ label: 'Noir', description: 'Dark.', preview: sneakPeek( imagePath ) },
			{ label: 'Paper', description: 'Light.', preview: '---\nnever closed' },
		];
		await expect(
			execute( presentDesignOptions, { catalog: 'layouts', question: 'Which layout?', options } )
		).rejects.toThrow( 'never closed' );

		options[ 1 ].preview = sneakPeek( imagePath );
		const text = await execute( presentDesignOptions, {
			catalog: 'layouts',
			question: 'Which layout?',
			options,
		} );
		expect( text ).toContain( `FAILED ${ imagePath }: blocked` );
		// Delivered once: a redraw has nothing left to report.
		expect(
			await execute( presentDesignOptions, {
				catalog: 'layouts',
				question: 'Which layout?',
				options,
			} )
		).toBe( 'The user picked option 1: Noir' );
	} );

	it( 'no longer treats a failed image as missing once it was generated again', async () => {
		const generation = deferredGeneration();
		await execute( generateImages, {
			images: [ { path: imagePath, subject: 'A latte' } ],
			background: true,
		} );
		generation.resolve( [ { ok: false, error: 'blocked' } ] );
		await mkdir( path.dirname( imagePath ), { recursive: true } );
		await writeFile( imagePath, JPEG );
		const text = await execute( presentDesignOptions, {
			catalog: 'layouts',
			question: 'Which layout?',
			options: [
				{ label: 'Noir', description: 'Dark.', preview: sneakPeek( imagePath ) },
				{ label: 'Paper', description: 'Light.', preview: sneakPeek( imagePath ) },
			],
		} );
		expect( text ).toContain( `FAILED ${ imagePath }: blocked` );
		expect( text ).not.toContain( 'solid color shape' );
		expect( renderedPreviews[ 0 ] ).toContain( 'src="data:image/jpeg;base64,' );
	} );

	it( 'still rejects an image that no job is generating', async () => {
		await expect(
			execute( presentDesignOptions, {
				catalog: 'layouts',
				question: 'Which layout should I build?',
				options: [
					{ label: 'Noir', description: 'Dark.', preview: sneakPeek( imagePath ) },
					{ label: 'Paper', description: 'Light.', preview: sneakPeek( imagePath ) },
				],
			} )
		).rejects.toThrow( 'Preview image not found' );
	} );

	it( 'renders an image that already exists without waiting', async () => {
		await mkdir( path.dirname( imagePath ), { recursive: true } );
		await writeFile( imagePath, JPEG );
		const text = await execute( presentDesignOptions, {
			catalog: 'layouts',
			question: 'Which layout should I build?',
			options: [
				{ label: 'Noir', description: 'Dark.', preview: sneakPeek( imagePath ) },
				{ label: 'Paper', description: 'Light.', preview: sneakPeek( imagePath ) },
			],
		} );
		expect( text ).toBe( 'The user picked option 1: Noir' );
		expect( mocks.generateImages ).not.toHaveBeenCalled();
	} );
} );
