import { describe, expect, it, vi } from 'vitest';
import { detect } from '../../lib/detect-platform/index.js';
import { captureScreenshots } from '../../lib/screenshot/screenshotter.js';
import { screenshotHandler } from './screenshot.js';
import type { HandlerContext } from '../handler-types.js';

vi.mock( '../../lib/detect-platform/index.js', () => ( { detect: vi.fn() } ) );
vi.mock( '../../lib/screenshot/screenshotter.js', () => ( { captureScreenshots: vi.fn() } ) );

describe( 'screenshotHandler', () => {
	it( 'explicitly enables PNG capture for the dedicated screenshot tool', async () => {
		vi.mocked( detect ).mockResolvedValueOnce( {
			url: 'https://example.com/',
			platform: 'fake',
			confidence: 'high',
			signals: [],
		} );
		vi.mocked( captureScreenshots ).mockResolvedValueOnce( {
			captured: 1,
			skipped: 0,
			failed: 0,
			browserRestarts: 0,
			durationMs: 1,
			manifestPath: '/tmp/capture/screenshots/manifest.json',
		} );
		const ctx = {
			adapters: [],
			findAdapter: vi.fn().mockReturnValue( null ),
			textResult: vi.fn( ( data ) => ( {
				content: [ { type: 'text' as const, text: JSON.stringify( data ) } ],
			} ) ),
			errorResult: vi.fn(),
			server: {} as never,
		} satisfies HandlerContext;

		await screenshotHandler(
			{ url: 'https://example.com/', outputDir: '/tmp/capture', urls: [ 'https://example.com/' ] },
			ctx
		);

		expect( captureScreenshots ).toHaveBeenCalledWith(
			expect.objectContaining( { captureImages: true } )
		);
	} );
} );
