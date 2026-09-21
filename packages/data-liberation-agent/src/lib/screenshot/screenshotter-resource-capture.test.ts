import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectBrowser } from '../browser-kit/index.js';
import { __resetSourceSessionsForTests } from '../browser-kit/browser-kit.js';
import { captureScreenshots } from './screenshotter.js';

const mocks = vi.hoisted( () => ( {
	captureDomDependencies: vi.fn().mockResolvedValue( undefined ),
	getReplayableResponse: vi.fn(),
} ) );

vi.mock( '../browser-kit/index.js', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import( '../browser-kit/index.js' ) >() ),
	connectBrowser: vi.fn(),
} ) );

vi.mock( './resource-capture.js', () => ( {
	CapturedResourceStore: class {
		captureDomDependencies = mocks.captureDomDependencies;
		getReplayableResponse = mocks.getReplayableResponse;
		observe = vi.fn();
		settle = vi.fn().mockResolvedValue( undefined );
		flush = vi.fn().mockResolvedValue( undefined );
	},
} ) );

function makePage( mobile: boolean, routedRequest?: object ) {
	let routeHandler: ( route: object ) => Promise< void >;
	return {
		route: vi.fn().mockImplementation( async ( _pattern, handler ) => {
			routeHandler = handler;
		} ),
		goto: vi.fn().mockImplementation( async () => {
			if ( routedRequest ) await routeHandler( routedRequest );
			return { status: () => 200 };
		} ),
		content: vi
			.fn()
			.mockResolvedValue(
				mobile
					? '<html><head><style>.hero{background:url("mobile-only.jpg")}</style></head><body>mobile</body></html>'
					: '<html><body>desktop</body></html>'
			),
		screenshot: vi.fn().mockResolvedValue( Buffer.from( 'png' ) ),
		waitForLoadState: vi.fn().mockResolvedValue( undefined ),
		evaluate: vi.fn().mockImplementation( async ( callback: unknown ) => {
			const source = String( callback );
			if ( source.includes( 'DOCTYPE' ) ) {
				return mobile
					? '<html><head><style>.hero{background:url("mobile-only.jpg")}</style></head><body>mobile</body></html>'
					: '<html><body>desktop</body></html>';
			}
			if ( source.includes( 'motionAnimatedElements' ) ) return { rows: [], landmarks: [] };
			if ( source.includes( 'scrollHeight' ) ) return 0;
			if ( source.includes( 'querySelectorAll' ) && source.includes( "'img'" ) ) return {};
			return {
				palette: [],
				typography: {},
				metadata: {
					title: '',
					metaDescription: '',
					openGraph: {},
					jsonLdTypes: [],
					htmlBytes: 0,
				},
				breakpoints: { minWidth: [], maxWidth: [] },
			};
		} ),
	};
}

describe( 'screenshot resource capture', () => {
	// Both cases below capture https://example.com/, and the session harvest
	// caches per origin — reset so each case pays for (and consumes a mocked
	// page/newContext call for) its own harvest.
	beforeEach( () => {
		__resetSourceSessionsForTests();
	} );

	it( 'discovers dependencies in both desktop and mobile HTML', async () => {
		const parent = join( process.cwd(), '.tmp-test' );
		mkdirSync( parent, { recursive: true } );
		const outputDir = mkdtempSync( join( parent, 'screenshot-resources-' ) );
		mocks.captureDomDependencies.mockClear();
		mocks.getReplayableResponse.mockReset();
		const newContext = vi.fn().mockImplementation( async ( options: { viewport?: { width: number } } ) => ( {
			newPage: vi.fn().mockResolvedValue( makePage( options.viewport?.width === 402 ) ),
				addInitScript: vi.fn().mockResolvedValue( undefined ),
				close: vi.fn().mockResolvedValue( undefined ),
				storageState: vi.fn().mockResolvedValue( { cookies: [], origins: [] } ),
			} ) );
		( connectBrowser as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			newContext,
			newBrowserCDPSession: vi.fn().mockResolvedValue( {
				send: vi.fn().mockResolvedValue( {
					userAgent:
						'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36',
				} ),
				detach: vi.fn().mockResolvedValue( undefined ),
			} ),
			close: vi.fn().mockResolvedValue( undefined ),
		} );

		try {
			await captureScreenshots( {
				urls: [ 'https://example.com/' ],
				outputDir,
				concurrency: 1,
				settleMs: 0,
				publicUrlsOnly: true,
			} );

			expect( mocks.captureDomDependencies ).toHaveBeenCalledTimes( 2 );
			expect( mocks.captureDomDependencies ).toHaveBeenCalledWith(
				expect.stringContaining( 'mobile-only.jpg' ),
				'https://example.com/'
			);
			// newContext call 0 is the one-time session harvest (see
			// sourceContextOptions in screenshotter.ts), before either real
			// viewport capture.
			// Desktop loads as the bundled browser, minus the headless marker that
			// anti-bot challenges refuse.
			const desktopContext = newContext.mock.calls[ 1 ][ 0 ];
			expect( desktopContext ).toMatchObject( {
				viewport: { width: 1440 },
				userAgent:
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36',
			} );
			const mobileContext = newContext.mock.calls[ 2 ][ 0 ];
			expect( mobileContext ).toMatchObject( {
				viewport: { width: 402, height: 681 },
				screen: { width: 402, height: 874 },
				deviceScaleFactor: 3,
				isMobile: true,
				hasTouch: true,
				userAgent:
					'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
			} );
		} finally {
			rmSync( outputDir, { recursive: true, force: true } );
		}
	} );

	it( 'fulfills cacheable static requests from captured resources', async () => {
		const parent = join( process.cwd(), '.tmp-test' );
		mkdirSync( parent, { recursive: true } );
		const outputDir = mkdtempSync( join( parent, 'screenshot-resource-replay-' ) );
		const fulfill = vi.fn().mockResolvedValue( undefined );
		const continueRequest = vi.fn().mockResolvedValue( undefined );
		const routedRequest = {
			request: () => ( {
				url: () => 'https://example.com/assets/site.css',
				method: () => 'GET',
				headers: () => ( {} ),
				resourceType: () => 'stylesheet',
			} ),
			abort: vi.fn().mockResolvedValue( undefined ),
			continue: continueRequest,
			fulfill,
		};
		mocks.getReplayableResponse.mockReset().mockReturnValue( {
			path: '/capture/resources/assets/site.css',
			contentType: 'text/css',
			headers: { 'access-control-allow-origin': '*' },
		} );
		( connectBrowser as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			newContext: vi.fn().mockImplementation( async ( options: { viewport?: { width: number } } ) => ( {
				newPage: vi.fn().mockResolvedValue(
					makePage( options.viewport?.width === 402, routedRequest )
				),
				addInitScript: vi.fn().mockResolvedValue( undefined ),
				close: vi.fn().mockResolvedValue( undefined ),
				storageState: vi.fn().mockResolvedValue( { cookies: [], origins: [] } ),
			} ) ),
			close: vi.fn().mockResolvedValue( undefined ),
		} );

		try {
			await captureScreenshots( {
				urls: [ 'https://example.com/' ],
				outputDir,
				concurrency: 1,
				settleMs: 0,
				publicUrlsOnly: true,
			} );
			expect( mocks.getReplayableResponse ).toHaveBeenCalledWith(
				'https://example.com/assets/site.css',
				'stylesheet'
			);
			expect( fulfill ).toHaveBeenCalledWith( {
				path: '/capture/resources/assets/site.css',
				contentType: 'text/css',
				headers: { 'access-control-allow-origin': '*' },
			} );
			expect( continueRequest ).not.toHaveBeenCalled();
		} finally {
			rmSync( outputDir, { recursive: true, force: true } );
		}
	} );
} );
