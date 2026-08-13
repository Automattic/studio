import { describe, expect, it, vi } from 'vitest';
import { captureHandler } from './capture.js';
import { extractHandler } from './extract.js';
import { safeFetch } from '../../lib/media-fetch/safe-fetch.js';
import type { HandlerContext } from '../handler-types.js';

vi.mock( './extract.js', () => ( {
	extractHandler: vi.fn(),
} ) );

vi.mock( '../../lib/media-fetch/safe-fetch.js', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('../../lib/media-fetch/safe-fetch.js') >() ),
	safeFetch: vi.fn(),
} ) );

describe( 'captureHandler', () => {
	it( 'rejects internal URLs before extraction', async () => {
		vi.mocked( safeFetch ).mockRejectedValueOnce(
			new Error( 'internal/loopback IP address not allowed' )
		);
		await expect(
			captureHandler( { url: 'http://127.0.0.1', outputDir: '/tmp/capture' }, {} as HandlerContext )
		).rejects.toThrow( 'internal/loopback IP address not allowed' );
		expect( extractHandler ).not.toHaveBeenCalled();
	} );

	it( 'passes the validated final URL to guarded screenshot capture', async () => {
		vi.mocked( safeFetch ).mockResolvedValueOnce( {
			finalUrl: 'https://www.example.com/',
			status: 200,
			headers: new Headers(),
			body: Buffer.from( 'ok' ),
		} );
		vi.mocked( extractHandler ).mockResolvedValueOnce( { content: [] } );

		await captureHandler(
			{ url: 'https://example.com', outputDir: '/tmp/capture' },
			{} as HandlerContext
		);

		expect( safeFetch ).toHaveBeenCalledWith( 'https://example.com', { timeoutMs: 10_000 } );
		expect( extractHandler ).toHaveBeenCalledWith(
			expect.objectContaining( {
				url: 'https://www.example.com/',
				screenshots: true,
				publicUrlsOnly: true,
			} ),
			expect.anything()
		);
	} );
} );
