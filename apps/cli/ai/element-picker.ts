/**
 * Element picker — opens a headed Playwright browser with the AI Canvas app,
 * which renders the site in an iframe and lets the user select DOM elements.
 *
 * The browser stays open and selections flow back to the CLI asynchronously
 * via Playwright's exposeFunction bridge. No blocking — the user can select
 * elements at any time, even while a prompt is running.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __pickDirname = dirname( fileURLToPath( import.meta.url ) );

export interface PickedElement {
	tagName: string;
	selector: string;
	outerHTML: string;
	innerText: string;
	computedStyles: Record< string, string >;
	boundingRect: { x: number; y: number; width: number; height: number };
	wpBlockType: string | null;
	ancestors: string[];
}

type Browser = Awaited< ReturnType< typeof import('playwright').chromium.launch > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

export type SelectionCallback = ( element: PickedElement ) => void;

export class ElementPicker {
	private browser: Browser | null = null;
	private page: Page | null = null;
	private currentSiteUrl: string | null = null;
	private _latestSelection: PickedElement | null = null;
	private selectionCallback: SelectionCallback | null = null;

	/**
	 * The most recent element the user selected in the browser.
	 * Updated asynchronously whenever the user clicks an element.
	 */
	get latestSelection(): PickedElement | null {
		return this._latestSelection;
	}

	/**
	 * Clear the stored selection (e.g. after consuming it in a prompt).
	 */
	clearSelection(): void {
		this._latestSelection = null;
	}

	/**
	 * Open the browser with the AI Canvas. Non-blocking — returns immediately
	 * after the browser is ready. Selections arrive via the callback.
	 *
	 * If the browser is already open for the same site, this is a no-op.
	 * If the site changed, reopens with the new site.
	 */
	async open( siteUrl: string, onSelection: SelectionCallback ): Promise< void > {
		this.selectionCallback = onSelection;

		if ( this.currentSiteUrl === siteUrl && ( await this.isAlive() ) ) {
			// Browser already open for this site — nothing to do.
			return;
		}

		await this.closeBrowser();
		await this.openBrowser( siteUrl );
	}

	/**
	 * Whether the browser is currently open and alive.
	 */
	get isOpen(): boolean {
		return this.browser !== null && this.page !== null;
	}

	/**
	 * Close the browser. Call when the AI session ends.
	 */
	async close(): Promise< void > {
		await this.closeBrowser();
	}

	private handleSelection( data: PickedElement ): void {
		this._latestSelection = data;
		this.selectionCallback?.( data );
	}

	private async isAlive(): Promise< boolean > {
		if ( ! this.browser || ! this.page ) {
			return false;
		}
		try {
			await this.page.evaluate( () => true );
			return true;
		} catch {
			this.browser = null;
			this.page = null;
			this.currentSiteUrl = null;
			return false;
		}
	}

	private async openBrowser( siteUrl: string ): Promise< void > {
		const canvasHtmlPath = resolve( __pickDirname, 'ai-canvas', 'dist', 'index.html' );
		const canvasHtml = readFileSync( canvasHtmlPath, 'utf-8' );

		const { chromium } = await import( 'playwright' );
		this.browser = await chromium.launch( {
			headless: false,
			args: [ '--ignore-certificate-errors' ],
		} );

		this.page = await this.browser.newPage( {
			viewport: { width: 1280, height: 900 },
			ignoreHTTPSErrors: true,
		} );

		this.currentSiteUrl = siteUrl;

		// Expose a function the React app can call to send selections back to Node.
		await this.page.exposeFunction( '__studioOnElementSelected', ( data: PickedElement ) => {
			this.handleSelection( data );
		} );

		// Intercept requests to /__studio-canvas/ and serve the built React app.
		await this.page.route( '**/__studio-canvas/**', async ( route ) => {
			await route.fulfill( {
				status: 200,
				contentType: 'text/html',
				body: canvasHtml,
			} );
		} );

		await this.page.goto( `${ siteUrl }/__studio-canvas/`, {
			waitUntil: 'domcontentloaded',
			timeout: 30_000,
		} );

		// Clean up if the user closes the browser window.
		this.page.on( 'close', () => {
			this.browser = null;
			this.page = null;
			this.currentSiteUrl = null;
		} );
	}

	private async closeBrowser(): Promise< void > {
		if ( this.browser ) {
			await this.browser.close().catch( () => {} );
			this.browser = null;
			this.page = null;
			this.currentSiteUrl = null;
		}
	}
}
