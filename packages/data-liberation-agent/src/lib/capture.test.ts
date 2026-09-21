import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SectionSpec } from './replicate/section-extract.js';
import { SectionSpecsStore } from './replicate/section-specs-store.js';
import { MediaStubStore } from './resume-state/index.js';

const { captureScreenshotsMock } = vi.hoisted( () => ( {
	captureScreenshotsMock: vi.fn( async () => ( {
		captured: 1,
		skipped: 0,
		failed: 0,
		durationMs: 1,
	} ) ),
} ) );

vi.mock( './media-fetch/safe-fetch.js', () => ( {
	safeFetch: vi.fn( async ( url: string ) => ( { finalUrl: url } ) ),
} ) );

vi.mock( './detect-platform/index.js', () => ( {
	detect: vi.fn( async () => ( { platform: 'generic' } ) ),
} ) );

vi.mock( './screenshot/screenshotter.js', () => ( {
	captureScreenshots: captureScreenshotsMock,
} ) );

vi.mock( './capture-export.js', () => ( {
	exportWebsiteCapture: vi.fn( ( { outputDir }: { outputDir: string } ) =>
		join( outputDir, 'capture-receipt.json' )
	),
} ) );

vi.mock( './media-fetch/media.js', () => ( {
	downloadMedia: vi.fn( async ( url: string, outputDir: string ) => {
		if ( url.endsWith( 'failed.jpg' ) ) {
			return { localPath: null, error: 'download failed' };
		}
		mkdirSync( outputDir, { recursive: true } );
		const localPath = join( outputDir, `${ url.includes( 'mobile' ) ? 'mobile' : 'desktop' }.jpg` );
		writeFileSync( localPath, url );
		return { localPath, error: null };
	} ),
} ) );

import { captureWebsite, downloadCaptureSectionMedia, IncompleteCaptureError } from './capture.js';
import { exportWebsiteCapture } from './capture-export.js';

const root = join( process.cwd(), '.tmp-test', 'capture-section-media' );
const sourceUrl = 'https://example.com/';

function section( images: Array< { url: string } > ): SectionSpec {
	return {
		sectionIndex: 0,
		images,
		cells: [],
	} as unknown as SectionSpec;
}

describe( 'downloadCaptureSectionMedia', () => {
	afterEach( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'downloads deduplicated desktop and mobile section media and records failures', async () => {
		SectionSpecsStore.load( root ).set(
			sourceUrl,
			[
				section( [
					{ url: 'https://cdn.example.com/desktop.jpg' },
					{ url: 'https://cdn.example.com/failed.jpg' },
				] ),
			],
			[]
		);
		SectionSpecsStore.loadMobile( root ).set(
			sourceUrl,
			[
				section( [
					{ url: 'https://cdn.example.com/desktop.jpg' },
					{ url: 'https://cdn.example.com/mobile.jpg' },
				] ),
			],
			[],
			{ width: 402, height: 681 }
		);

		expect( await downloadCaptureSectionMedia( root, [ sourceUrl ] ) ).toBe( 2 );
		expect( Object.fromEntries( MediaStubStore.load( root ).list() ) ).toMatchObject( {
			'https://cdn.example.com/desktop.jpg': { status: 'success' },
			'https://cdn.example.com/mobile.jpg': { status: 'success' },
			'https://cdn.example.com/failed.jpg': { status: 'error', error: 'download failed' },
		} );
	} );

	it( 'does not download empty or self-referential page URLs as section media', async () => {
		SectionSpecsStore.load( root ).set(
			sourceUrl,
			[
				section( [
					{ url: sourceUrl },
					{ url: 'https://example.com' },
					{ url: '   ' },
					{ url: 'https://cdn.example.com/desktop.jpg' },
				] ),
			],
			[]
		);
		SectionSpecsStore.loadMobile( root ).set(
			sourceUrl,
			[ section( [ { url: 'https://example.com/about' } ] ) ],
			[],
			{ width: 402, height: 681 }
		);

		expect(
			await downloadCaptureSectionMedia( root, [ sourceUrl, 'https://example.com/about' ] )
		).toBe( 1 );
		expect( Object.fromEntries( MediaStubStore.load( root ).list() ) ).toEqual( {
			'https://cdn.example.com/desktop.jpg': expect.objectContaining( { status: 'success' } ),
		} );
	} );
} );

describe( 'captureWebsite fluid learning', () => {
	afterEach( () => {
		captureScreenshotsMock.mockClear();
		rmSync( root, { recursive: true, force: true } );
	} );

	it.each( [
		{ option: undefined, expected: true, label: 'defaults to enabled' },
		{ option: false, expected: false, label: 'supports explicit opt-out' },
	] )( '$label', async ( { option, expected } ) => {
		await captureWebsite(
			{
				url: sourceUrl,
				outputDir: root,
				...( option === undefined ? {} : { learnFluid: option } ),
			},
			{
				findAdapter: () => ( {
					id: 'generic',
					platform: 'generic',
					discover: async () => ( { urls: [] } ),
					extract: async () => ( { title: '', content: '' } ),
				} ),
			}
		);

		expect( captureScreenshotsMock ).toHaveBeenCalledWith(
			expect.objectContaining( { learnFluid: expected } )
		);
	} );
} );

describe( 'captureWebsite completeness', () => {
	afterEach( () => {
		vi.mocked( exportWebsiteCapture ).mockClear();
		rmSync( root, { recursive: true, force: true } );
	} );

	it( 'says the capture is incomplete when exported output links to uncaptured routes', async () => {
		vi.mocked( exportWebsiteCapture ).mockImplementationOnce( ( { outputDir } ) => {
			mkdirSync( outputDir, { recursive: true } );
			writeFileSync(
				join( outputDir, 'diagnostics.json' ),
				JSON.stringify( {
					unresolvedAnchors: [
						{
							sourceUrl,
							url: 'https://example.com/hyundai-i30n',
							reason: 'target route was not captured',
						},
					],
				} )
			);
			return join( outputDir, 'capture-receipt.json' );
		} );

		const result = await captureWebsite(
			{ url: sourceUrl, outputDir: root },
			{
				findAdapter: () => ( {
					id: 'generic',
					platform: 'generic',
					discover: async () => ( { urls: [] } ),
					extract: async () => ( { title: '', content: '' } ),
				} ),
			}
		);

		expect( result.complete ).toBe( false );
		expect( result.summary.complete ).toBe( false );
		expect( result.unresolvedAnchors ).toEqual( [
			{
				sourceUrl,
				url: 'https://example.com/hyundai-i30n',
				reason: 'target route was not captured',
			},
		] );
	} );

	it( 'preserves source-absent link diagnostics in a complete strict capture', async () => {
		const realExport = await vi.importActual< typeof import('./capture-export.js') >( './capture-export.js' );
		vi.mocked( exportWebsiteCapture ).mockImplementationOnce( realExport.exportWebsiteCapture );
		captureScreenshotsMock.mockResolvedValueOnce( { captured: 1, skipped: 1, failed: 0, durationMs: 1 } );
		mkdirSync( join( root, 'html' ), { recursive: true } );
		mkdirSync( join( root, 'screenshots' ), { recursive: true } );
		writeFileSync( join( root, 'html', 'home.html' ), '<h1>Home</h1><a href="/gone">Gone</a>' );
		writeFileSync( join( root, 'screenshots', 'manifest.json' ), JSON.stringify( {
			version: 1, entries: { [ sourceUrl ]: { html: 'html/home.html' }, 'https://example.com/gone': {} },
		} ) );
		writeFileSync( join( root, 'screenshots', 'failures.json' ), JSON.stringify( [ { url: 'https://example.com/gone', error: 'HTTP 404' } ] ) );
		const result = await captureWebsite( { url: sourceUrl, outputDir: root, strict: true }, {
			findAdapter: () => ( {
				id: 'generic', platform: 'generic',
				discover: async () => ( { urls: [ { url: 'https://example.com/gone', type: 'page' } ] } ),
				extract: async () => ( { title: '', content: '' } ),
			} ),
		} );
		expect( result.complete ).toBe( true );
		expect( result.summary.complete ).toBe( true );
		expect( result.unresolvedAnchors ).toEqual( [ { sourceUrl, url: 'https://example.com/gone', reason: 'target route is absent at source' } ] );
	} );

	it( 'rejects in strict mode so programmatic callers fail closed', async () => {
		vi.mocked( exportWebsiteCapture ).mockImplementationOnce( ( { outputDir } ) => {
			mkdirSync( outputDir, { recursive: true } );
			writeFileSync(
				join( outputDir, 'diagnostics.json' ),
				JSON.stringify( {
					unresolvedAnchors: [
						{
							sourceUrl,
							url: 'https://example.com/missing',
							reason: 'target route was not captured',
						},
					],
				} )
			);
			return join( outputDir, 'capture-receipt.json' );
		} );

		await expect(
			captureWebsite(
				{ url: sourceUrl, outputDir: root, strict: true },
				{
					findAdapter: () => ( {
						id: 'generic',
						platform: 'generic',
						discover: async () => ( { urls: [] } ),
						extract: async () => ( { title: '', content: '' } ),
					} ),
				}
			)
		).rejects.toBeInstanceOf( IncompleteCaptureError );
	} );
} );
