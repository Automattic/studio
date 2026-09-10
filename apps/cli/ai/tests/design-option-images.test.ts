import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { generateImages, isImageGenerationAvailable } from 'cli/ai/image-generation';
import { setScreenshotDirectoryProvider } from 'cli/ai/screenshot-storage';
import { generateImagesTool } from '../tools/generate-images';
import { createPresentDesignOptionsTool, inlineLocalImages } from '../tools/present-design-options';

// Generated files are jailed to the sites root, so the tests get their own.
const mocks = vi.hoisted( () => {
	const fs = require( 'node:fs' ) as typeof import('node:fs');
	const os = require( 'node:os' ) as typeof import('node:os');
	const path = require( 'node:path' ) as typeof import('node:path');
	return { sitesRoot: fs.mkdtempSync( path.join( os.tmpdir(), 'studio-sites-' ) ) };
} );

vi.mock( 'cli/lib/site-paths', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('cli/lib/site-paths') >();
	return { ...actual, STUDIO_SITES_ROOT: mocks.sitesRoot };
} );

vi.mock( 'cli/ai/image-generation', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('cli/ai/image-generation') >();
	return { ...actual, generateImages: vi.fn(), isImageGenerationAvailable: vi.fn() };
} );

vi.mock( 'cli/ai/browser-utils', () => ( { getSharedBrowser: vi.fn() } ) );

const siteImage = ( name: string ) =>
	path.join( mocks.sitesRoot, 'harbor', 'wp-content', 'uploads', 'studio-generated', name );

afterAll( async () => {
	await rm( mocks.sitesRoot, { recursive: true, force: true } );
} );

describe( 'generate_images per-image grade', () => {
	beforeEach( () => {
		vi.mocked( isImageGenerationAvailable ).mockResolvedValue( true );
		vi.mocked( generateImages ).mockImplementation( async ( requests ) =>
			requests.map( () => ( { ok: true, bytes: Buffer.from( 'jpeg' ) } ) )
		);
	} );

	it( 'lets each design option carry its own grade while others keep the call-wide one', async () => {
		await generateImagesTool.rawHandler( {
			images: [
				{
					path: siteImage( 'option-1-hero.jpg' ),
					subject: 'A bakery counter at dawn',
					imageGrade: 'high-contrast black and white',
				},
				{
					path: siteImage( 'option-2-hero.jpg' ),
					subject: 'A bakery counter at dawn',
					imageGrade: 'saturated candy colors',
				},
				{ path: siteImage( 'about.jpg' ), subject: 'Flour on a wooden board' },
			],
			siteContext: 'A neighborhood bakery.',
			imageGrade: 'warm natural window light',
		} as never );

		const prompts = vi.mocked( generateImages ).mock.calls[ 0 ][ 0 ].map( ( r ) => r.prompt );
		expect( prompts[ 0 ] ).toContain(
			'Art direction for all site imagery: high-contrast black and white.'
		);
		expect( prompts[ 0 ] ).not.toContain( 'warm natural window light' );
		expect( prompts[ 1 ] ).toContain( 'saturated candy colors' );
		expect( prompts[ 2 ] ).toContain(
			'Art direction for all site imagery: warm natural window light.'
		);
		await expect( readFile( siteImage( 'option-1-hero.jpg' ), 'utf8' ) ).resolves.toBe( 'jpeg' );
	} );
} );

describe( 'sneak-peek image inlining', () => {
	it( 'inlines src and url() references to generated images as data URLs', async () => {
		await mkdir( path.dirname( siteImage( 'x' ) ), { recursive: true } );
		await writeFile( siteImage( 'hero.jpg' ), 'jpeg-bytes' );
		const encoded = Buffer.from( 'jpeg-bytes' ).toString( 'base64' );
		const html = `<style>.hero{background:url(${ siteImage(
			'hero.jpg'
		) })}</style><img src="${ siteImage( 'hero.jpg' ) }"><img src='file://${ siteImage(
			'hero.jpg'
		) }'><img src="https://example.com/keep.jpg">`;

		const inlined = await inlineLocalImages( html );

		expect( inlined ).toContain( `background:url(data:image/jpeg;base64,${ encoded })` );
		expect( inlined ).toContain( `<img src="data:image/jpeg;base64,${ encoded }">` );
		expect( inlined ).toContain( `<img src='data:image/jpeg;base64,${ encoded }'>` );
		expect( inlined ).toContain( 'src="https://example.com/keep.jpg"' );
		expect( inlined ).not.toContain( mocks.sitesRoot );
	} );

	it( 'rejects images outside the sites root and files that do not exist', async () => {
		const outside = path.join( os.tmpdir(), 'elsewhere.jpg' );
		await expect( inlineLocalImages( `<img src="${ outside }">` ) ).rejects.toThrow(
			/inside the Studio sites directory/
		);
		await expect(
			inlineLocalImages( `<img src="${ siteImage( 'missing.jpg' ) }">` )
		).rejects.toThrow( /not found.*Generate it first/ );
	} );

	it( 'present_design_options renders the inlined page and names the option that failed', async () => {
		const screenshots = await mkdtemp( path.join( os.tmpdir(), 'studio-previews-' ) );
		setScreenshotDirectoryProvider( () => screenshots );
		await mkdir( path.dirname( siteImage( 'x' ) ), { recursive: true } );
		await writeFile( siteImage( 'option-1-hero.jpg' ), 'one' );
		const page = () => ( {
			emulateMedia: vi.fn(),
			goto: vi.fn(),
			waitForLoadState: vi.fn().mockResolvedValue( undefined ),
			evaluate: vi.fn().mockResolvedValue( 900 ),
			addStyleTag: vi.fn(),
			screenshot: vi.fn().mockResolvedValue( Buffer.from( 'png' ) ),
			close: vi.fn(),
		} );
		vi.mocked( getSharedBrowser ).mockResolvedValue( {
			newPage: vi.fn().mockResolvedValue( page() ),
		} as never );
		const onAskUser = vi.fn().mockResolvedValue( { Which: 'A' } );
		const tool = createPresentDesignOptionsTool( onAskUser );
		try {
			await tool.rawHandler(
				{
					question: 'Which',
					options: [
						{
							label: 'A',
							description: 'a',
							html: `<img src="${ siteImage( 'option-1-hero.jpg' ) }">`,
						},
						{ label: 'B', description: 'b', html: '<p>typographic</p>' },
					],
				} as never,
				{ onProgress: () => {} }
			);
			const files = await readdir( screenshots );
			const previewHtml = await readFile(
				path.join(
					screenshots,
					files.find( ( name ) => name.startsWith( 'preview-1-' ) && name.endsWith( '.html' ) )!
				),
				'utf8'
			);
			expect( previewHtml ).toContain(
				`data:image/jpeg;base64,${ Buffer.from( 'one' ).toString( 'base64' ) }`
			);

			await expect(
				tool.rawHandler(
					{
						question: 'Which',
						options: [
							{ label: 'A', description: 'a', html: '<p>a</p>' },
							{ label: 'B', description: 'b', html: `<img src="${ siteImage( 'nope.jpg' ) }">` },
						],
					} as never,
					{ onProgress: () => {} }
				)
			).rejects.toThrow( /Option 2 \("B"\): Preview image not found/ );
		} finally {
			setScreenshotDirectoryProvider( null );
			await rm( screenshots, { recursive: true, force: true } );
		}
	} );
} );
