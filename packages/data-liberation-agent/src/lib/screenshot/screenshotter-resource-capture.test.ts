import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { connectBrowser } from '../browser-kit/index.js';
import { captureScreenshots } from './screenshotter.js';

const mocks = vi.hoisted( () => ( {
	captureDomDependencies: vi.fn().mockResolvedValue( undefined ),
	getReplayableResponse: vi.fn(),
} ) );

vi.mock( '../browser-kit/index.js', () => ( {
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
	it( 'discovers dependencies in both desktop and mobile HTML', async () => {
		const parent = join( process.cwd(), '.tmp-test' );
		mkdirSync( parent, { recursive: true } );
		const outputDir = mkdtempSync( join( parent, 'screenshot-resources-' ) );
		mocks.captureDomDependencies.mockClear();
		mocks.getReplayableResponse.mockReset();
		( connectBrowser as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			newContext: vi.fn().mockImplementation( async ( options: { isMobile?: boolean } ) => ( {
				newPage: vi.fn().mockResolvedValue( makePage( options.isMobile === true ) ),
				addInitScript: vi.fn().mockResolvedValue( undefined ),
				close: vi.fn().mockResolvedValue( undefined ),
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

			expect( mocks.captureDomDependencies ).toHaveBeenCalledTimes( 2 );
			expect( mocks.captureDomDependencies ).toHaveBeenCalledWith(
				expect.stringContaining( 'mobile-only.jpg' ),
				'https://example.com/'
			);
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
			newContext: vi.fn().mockImplementation( async ( options: { isMobile?: boolean } ) => ( {
				newPage: vi.fn().mockResolvedValue(
					makePage( options.isMobile === true, routedRequest )
				),
				addInitScript: vi.fn().mockResolvedValue( undefined ),
				close: vi.fn().mockResolvedValue( undefined ),
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
