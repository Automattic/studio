import { describe, expect, it, vi } from 'vitest';
import { exportWebsiteCapture } from '../../lib/capture-export.js';
import { detect } from '../../lib/detect-platform/index.js';
import { safeFetch } from '../../lib/media-fetch/safe-fetch.js';
import { captureScreenshots } from '../../lib/screenshot/screenshotter.js';
import { captureHandler } from './capture.js';
import type { PlatformAdapter } from '../../types.js';
import type { HandlerContext } from '../handler-types.js';

vi.mock( '../../lib/media-fetch/safe-fetch.js', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('../../lib/media-fetch/safe-fetch.js') >() ),
	safeFetch: vi.fn(),
} ) );
vi.mock( '../../lib/detect-platform/index.js', () => ( { detect: vi.fn() } ) );
vi.mock( '../../lib/screenshot/screenshotter.js', () => ( { captureScreenshots: vi.fn() } ) );
vi.mock( '../../lib/capture-export.js', () => ( { exportWebsiteCapture: vi.fn() } ) );

function context( adapter: PlatformAdapter ): HandlerContext {
	return {
		adapters: [ adapter ],
		findAdapter: vi.fn().mockReturnValue( adapter ),
		textResult: vi.fn( ( data ) => ( {
			content: [ { type: 'text' as const, text: JSON.stringify( data ) } ],
		} ) ),
		errorResult: vi.fn( ( message ) => ( {
			content: [ { type: 'text' as const, text: message } ],
			isError: true,
		} ) ),
		server: { sendLoggingMessage: vi.fn() } as never,
	};
}

describe( 'captureHandler', () => {
	it( 'rejects internal URLs before discovery', async () => {
		vi.mocked( safeFetch ).mockRejectedValueOnce(
			new Error( 'internal/loopback IP address not allowed' )
		);
		const adapter = { discover: vi.fn(), extract: vi.fn() } as unknown as PlatformAdapter;
		await expect(
			captureHandler( { url: 'http://127.0.0.1', outputDir: '/tmp/capture' }, context( adapter ) )
		).rejects.toThrow( 'internal/loopback IP address not allowed' );
		expect( adapter.discover ).not.toHaveBeenCalled();
	} );

	it( 'captures a portable artifact without running content extraction', async () => {
		vi.mocked( safeFetch ).mockResolvedValueOnce( {
			finalUrl: 'https://www.example.com/shop?variant=compact',
			status: 200,
			headers: new Headers(),
			body: Buffer.from( 'ok' ),
		} );
		vi.mocked( detect ).mockResolvedValueOnce( {
			url: 'https://www.example.com/shop?variant=compact',
			platform: 'wix',
			confidence: 'high',
			signals: [],
		} );
		const adapter = {
			discover: vi.fn().mockResolvedValue( {
				siteMeta: { title: 'Example' },
				urls: [
					{ url: 'https://www.example.com/shop', type: 'homepage' },
					{ url: 'https://www.example.com/about', type: 'page' },
				],
			} ),
			extract: vi.fn(),
		} as unknown as PlatformAdapter;
		vi.mocked( captureScreenshots ).mockResolvedValueOnce( {
			captured: 2,
			skipped: 0,
			failed: 0,
			browserRestarts: 0,
			durationMs: 100,
			manifestPath: '/tmp/capture/screenshots/manifest.json',
		} );
		vi.mocked( exportWebsiteCapture ).mockReturnValueOnce( '/tmp/capture/capture-receipt.json' );
		const onProgress = vi.fn();
		const handlerContext = context( adapter );

		await captureHandler(
			{
				url: 'https://example.com',
				outputDir: '/tmp/capture',
				onProgress,
			},
			handlerContext
		);

		expect( safeFetch ).toHaveBeenCalledWith( 'https://example.com', { timeoutMs: 10_000 } );
		expect( adapter.extract ).not.toHaveBeenCalled();
		expect( captureScreenshots ).toHaveBeenCalledWith(
			expect.objectContaining( {
				urls: [ 'https://www.example.com/shop?variant=compact', 'https://www.example.com/about' ],
				primaryUrl: 'https://www.example.com/shop?variant=compact',
				captureImages: false,
				publicUrlsOnly: true,
			} )
		);
		expect( exportWebsiteCapture ).toHaveBeenCalledWith(
			expect.objectContaining( {
				sourceUrl: 'https://www.example.com/shop?variant=compact',
				platform: 'wix',
			} )
		);
		expect( onProgress ).toHaveBeenCalledWith(
			expect.objectContaining( {
				phase: 'complete',
				current: 2,
				total: 2,
				elapsedMs: expect.any( Number ),
				phaseElapsedMs: expect.any( Number ),
			} )
		);
		expect( onProgress.mock.calls.map( ( [ progress ] ) => progress.phase ) ).toEqual( [
			'discovering',
			'capturing',
			'finalizing',
			'complete',
		] );
		expect( handlerContext.server.sendLoggingMessage ).toHaveBeenCalledTimes( 4 );
	} );
} );
