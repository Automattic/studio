import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { getSharedBrowser } from 'cli/ai/browser-utils';
import { emitProgress } from 'cli/logger';
import { errorResult } from './utils';

const VIEWPORTS = {
	desktop: { width: 1040, height: 1248 },
	mobile: { width: 390, height: 844 },
} as const;

export const takeScreenshotTool = tool(
	'take_screenshot',
	'Takes a full-page screenshot of a URL. Returns the screenshot as an image that you can analyze visually. ' +
		'Supports desktop and mobile viewports. Use this to verify the site looks correct after building it.',
	{
		url: z.string().describe( 'The URL to screenshot' ),
		viewport: z
			.enum( [ 'desktop', 'mobile' ] )
			.optional()
			.describe(
				'Viewport size: "desktop" (1040x1248) or "mobile" (390x844). Defaults to desktop.'
			),
	},
	async ( args ) => {
		try {
			const viewportType = args.viewport ?? 'desktop';
			const viewport = VIEWPORTS[ viewportType ];

			emitProgress( `Taking ${ viewportType } screenshot of ${ args.url }…` );

			const browser = await getSharedBrowser();
			const page = await browser.newPage( { viewport } );

			try {
				await page.emulateMedia( { reducedMotion: 'reduce' } );

				await page.goto( args.url, { waitUntil: 'domcontentloaded', timeout: 30000 } );
				await page.waitForLoadState( 'networkidle', { timeout: 10000 } ).catch( () => {} );

				await page.evaluate( async () => {
					const delay = ( ms: number ) =>
						new Promise< void >( ( resolve ) => setTimeout( resolve, ms ) );
					const scrollHeight = document.body.scrollHeight;
					const viewportHeight = window.innerHeight;
					for ( let y = 0; y < scrollHeight; y += viewportHeight ) {
						window.scrollTo( 0, y );
						await delay( 100 );
					}
					window.scrollTo( 0, 0 );

					const timeout = new Promise< void >( ( resolve ) => setTimeout( resolve, 5000 ) );
					const allImages = Promise.all(
						Array.from( document.images )
							.filter( ( img ) => ! img.complete )
							.map(
								( img ) =>
									new Promise< void >( ( resolve ) => {
										img.addEventListener( 'load', () => resolve() );
										img.addEventListener( 'error', () => resolve() );
									} )
							)
					);
					await Promise.race( [ allImages, timeout ] );
				} );

				await page.addStyleTag( {
					content: `
						#wpadminbar { display: none !important; }
						html { margin-top: 0 !important; }
						::-webkit-scrollbar { display: none !important; }
						html, body { scrollbar-width: none !important; }
					`,
				} );

				const buffer = await page.screenshot( { fullPage: true, type: 'png' } );
				const base64 = buffer.toString( 'base64' );

				emitProgress( `Screenshot captured (${ viewportType })` );

				return {
					content: [
						{
							type: 'image' as const,
							data: base64,
							mimeType: 'image/png',
						},
					],
				};
			} finally {
				await page.close();
			}
		} catch ( error ) {
			return errorResult(
				`Screenshot failed: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
