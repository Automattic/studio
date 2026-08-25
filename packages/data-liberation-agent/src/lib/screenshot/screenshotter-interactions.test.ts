import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { connectBrowser } from '../browser-kit/index.js';
import { captureTriggeredDialogs } from './interaction-capture.js';
import { captureScreenshots } from './screenshotter.js';

vi.mock( '../url/index.js', async ( importOriginal ) => {
	const actual = ( await importOriginal() ) as Record< string, unknown >;
	return {
		...actual,
		slugify: ( url: string ) => new URL( url ).pathname.replace( /^\//, '' ) || 'homepage',
	};
} );

vi.mock( '../browser-kit/index.js', () => ( {
	connectBrowser: vi.fn(),
} ) );

vi.mock( './interaction-capture.js', () => ( {
	captureTriggeredDialogs: vi.fn(),
} ) );

const LOCAL_TMP = join( process.cwd(), '.tmp-test' );
mkdirSync( LOCAL_TMP, { recursive: true } );

function makePage() {
	let currentUrl = '';
	return {
		goto: vi.fn().mockImplementation( async ( url: string ) => {
			currentUrl = url;
			return { status: () => 200 };
		} ),
		content: vi.fn().mockResolvedValue( '<html><body>Tianna Wolfson</body></html>' ),
		screenshot: vi.fn().mockResolvedValue( Buffer.from( 'fakepng' ) ),
		waitForLoadState: vi.fn().mockResolvedValue( undefined ),
		evaluate: vi.fn().mockImplementation( async ( fn: unknown ) => {
			const source = String( fn );
			if ( source.includes( 'motionAnimatedElements' ) ) return { rows: [], landmarks: [] };
			if ( source.includes( 'scrollHeight' ) ) return 3000;
			if ( source.includes( 'scrollTo' ) ) return undefined;
			return {
				palette: [ { hex: currentUrl ? '#111111' : '#222222', count: 10 } ],
				typography: {},
				metadata: { title: '', metaDescription: '', openGraph: {}, jsonLdTypes: [], htmlBytes: 0 },
				breakpoints: { minWidth: [], maxWidth: [] },
			};
		} ),
	};
}

describe( 'captureScreenshots interactions', () => {
	it( 'captures a mobile-only Tianna dialog once without overwriting it on desktop', async () => {
		const outputDir = mkdtempSync( join( LOCAL_TMP, 'ss-' ) );
		const mobilePage = makePage();
		const desktopPage = makePage();
		const pages = [ mobilePage, desktopPage ];
		const captureDialogs = vi.mocked( captureTriggeredDialogs );
		let triggerClicks = 0;

		captureDialogs.mockImplementation( async ( page, sourceUrl ) => {
			if ( ( page as unknown ) === mobilePage ) {
				triggerClicks++;
				return {
					schema: 'data-liberation/interaction-states/v1',
					sourceUrl,
					viewport: { width: 390, height: 844 },
					capturedAt: '2026-08-25T00:00:00.000Z',
					states: [
						{
							status: 'captured',
							trigger: {
								selector: '#tianna-mobile-menu',
								tag: 'button',
								ariaHaspopup: 'dialog',
								dataBindings: {},
							},
							dialog: {
								selector: '#site-navigation',
								tag: 'dialog',
								id: 'site-navigation',
								ariaModal: true,
								html: '<dialog id="site-navigation">Tianna Wolfson</dialog>',
								htmlBytes: 60,
								htmlTruncated: false,
							},
						},
					],
				};
			}
			return {
				schema: 'data-liberation/interaction-states/v1',
				sourceUrl,
				viewport: { width: 1440, height: 900 },
				capturedAt: '2026-08-25T00:00:00.000Z',
				states: [],
			};
		} );

		( connectBrowser as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			newContext: vi.fn().mockImplementation( () =>
				Promise.resolve( {
					newPage: vi.fn().mockResolvedValue( pages.shift()! ),
					addInitScript: vi.fn().mockResolvedValue( undefined ),
					close: vi.fn().mockResolvedValue( undefined ),
				} )
			),
			close: vi.fn().mockResolvedValue( undefined ),
		} );

		try {
			await captureScreenshots( {
				urls: [ 'https://example.com/tianna' ],
				outputDir,
				concurrency: 1,
				settleMs: 0,
				captureImages: true,
				viewports: [
					{ id: 'mobile', width: 390, height: 844 },
					{ id: 'desktop', width: 1440, height: 900 },
				],
			} );

			expect( captureDialogs ).toHaveBeenCalledOnce();
			expect( captureDialogs ).toHaveBeenCalledWith( mobilePage, 'https://example.com/tianna' );
			expect( triggerClicks ).toBe( 1 );
			expect( mobilePage.screenshot.mock.invocationCallOrder.at( -1 ) ).toBeLessThan(
				captureDialogs.mock.invocationCallOrder[ 0 ]
			);
			expect( mobilePage.content.mock.invocationCallOrder.at( -1 ) ).toBeLessThan(
				captureDialogs.mock.invocationCallOrder[ 0 ]
			);

			const manifest = JSON.parse(
				readFileSync( join( outputDir, 'screenshots', 'manifest.json' ), 'utf8' )
			);
			expect( manifest.entries[ 'https://example.com/tianna' ].interactions ).toMatchObject( {
				viewport: { width: 390, height: 844 },
				states: [
					{
						status: 'captured',
						trigger: { tag: 'button', ariaHaspopup: 'dialog' },
					},
				],
			} );
		} finally {
			rmSync( outputDir, { recursive: true, force: true } );
		}
	} );
} );
