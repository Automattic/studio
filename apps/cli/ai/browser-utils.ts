/**
 * Shared browser management for AI tools.
 *
 * Provides a lazily-launched Playwright Chromium singleton used by both the
 * screenshot tool and the block validator.  A future Electron BrowserWindow
 * backend could be added behind the same interface.
 */

type Browser = Awaited< ReturnType< ( typeof import('playwright') )[ 'chromium' ][ 'launch' ] > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

let browserPromise: Promise< Browser > | null = null;

/**
 * Returns (and lazily launches) a shared Chromium browser instance.
 * The browser is cleaned up automatically on process exit.
 */
export async function getSharedBrowser(): Promise< Browser > {
	if ( ! browserPromise ) {
		browserPromise = ( async () => {
			const { chromium } = await import( 'playwright' );
			const browser = await chromium.launch( {
				args: [ '--ignore-certificate-errors' ],
			} );

			const cleanup = () => {
				browser.close().catch( () => {} );
				browserPromise = null;
			};
			process.on( 'exit', cleanup );
			process.on( 'SIGINT', cleanup );
			process.on( 'SIGTERM', cleanup );

			return browser;
		} )();
	}
	return browserPromise;
}

/** Collect diagnostic info from the page to help debug editor load failures. */
async function getPageDiagnostics( page: Page ): Promise< string > {
	try {
		const url = page.url();
		const info = await page.evaluate( () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const wp = ( window as any ).wp;
			return {
				hasWp: typeof wp !== 'undefined',
				hasWpBlocks: !! ( wp && wp.blocks ),
				hasGetBlockTypes: !! ( wp && wp.blocks && typeof wp.blocks.getBlockTypes === 'function' ),
				blockTypeCount: wp?.blocks?.getBlockTypes?.()?.length ?? 0,
				title: document.title,
				bodyClasses: document.body?.className?.slice( 0, 200 ) ?? '',
			};
		} );
		return `url=${ url }, title="${ info.title }", wp=${ info.hasWp }, wp.blocks=${ info.hasWpBlocks }, getBlockTypes=${ info.hasGetBlockTypes }, blockTypes=${ info.blockTypeCount }, body="${ info.bodyClasses }"`;
	} catch ( e ) {
		return `(diagnostics failed: ${ e instanceof Error ? e.message : String( e ) })`;
	}
}

/**
 * A long-lived page that stays open on a site's block editor so repeated
 * validation calls don't have to re-navigate and re-load all block scripts.
 */
export class EditorPage {
	private page: Page | null = null;
	private readonly siteUrl: string;

	constructor( siteUrl: string ) {
		this.siteUrl = siteUrl;
	}

	/** Get or create a page with the block editor loaded. */
	async getPage(): Promise< Page > {
		if ( this.page && ! this.page.isClosed() ) {
			return this.page;
		}

		const browser = await getSharedBrowser();
		const page = await browser.newPage( {
			ignoreHTTPSErrors: true,
		} );

		const loginUrl = `${ this.siteUrl }/studio-auto-login?redirect_to=/wp-admin/post-new.php`;
		await page.goto( loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 } );

		// Wait for the block editor scripts to be fully loaded and blocks registered.
		// wp is set early as a global but wp.blocks is populated later, so every
		// level must be checked to avoid "Cannot read properties of undefined".
		try {
			await page.waitForFunction(
				() => {
					try {
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const wp = ( window as any ).wp;
						return (
							wp &&
							wp.blocks &&
							typeof wp.blocks.getBlockTypes === 'function' &&
							wp.blocks.getBlockTypes().length > 0
						);
					} catch {
						return false;
					}
				},
				{ timeout: 30_000 }
			);
		} catch ( error ) {
			const diag = await getPageDiagnostics( page );
			await page.close();
			throw new Error(
				`Block editor failed to load (${ diag }): ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}

		this.page = page;
		return page;
	}

	async close(): Promise< void > {
		if ( this.page && ! this.page.isClosed() ) {
			await this.page.close();
		}
		this.page = null;
	}
}
