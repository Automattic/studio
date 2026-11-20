import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import type { Page } from 'playwright';

export interface PageOptions {
	viewport?: { width: number; height: number };
	deviceScaleFactor?: number;
	colorScheme?: 'light' | 'dark';
	// Emulates prefers-reduced-motion, so captures don't catch animations midway.
	reducedMotion?: boolean;
	// Runs in the page before its own scripts.
	initScript?: () => void;
	// 'networkidle' waits up to 30 seconds for the network to go quiet; by default
	// the page is ready once its DOM is, plus up to 2.5 seconds of quiet.
	waitUntil?: 'networkidle';
}

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_TIMEOUT_MS = 2500;

const statuses = new WeakMap< Page, number >();

/**
 * Opens a page in the shared browser and resolves once it has loaded. `signIn`
 * opens a site page as the site's administrator; `html` renders a document of
 * its own.
 */
export async function openPage(
	target: { url: string; signIn?: boolean } | { html: string },
	options: PageOptions = {}
): Promise< Page > {
	const browser = await getSharedBrowser();
	const page = await browser.newPage( {
		viewport: options.viewport,
		deviceScaleFactor: options.deviceScaleFactor,
		ignoreHTTPSErrors: true,
	} );
	try {
		if ( options.reducedMotion || options.colorScheme ) {
			await page.emulateMedia( {
				...( options.reducedMotion ? { reducedMotion: 'reduce' as const } : {} ),
				...( options.colorScheme ? { colorScheme: options.colorScheme } : {} ),
			} );
		}
		if ( options.initScript ) {
			await page.addInitScript( options.initScript );
		}
		let url: string;
		if ( 'html' in target ) {
			// A file rather than page.setContent, so the document's file: references load.
			const directory = await mkdtemp( path.join( os.tmpdir(), 'studio-page-' ) );
			page.once( 'close', () => void rm( directory, { recursive: true, force: true } ) );
			const documentFile = path.join( directory, 'index.html' );
			// The BOM makes the browser read the file as UTF-8 even when the
			// document does not declare a charset.
			await writeFile( documentFile, `\ufeff${ target.html }` );
			url = pathToFileURL( documentFile ).href;
		} else if ( target.signIn ) {
			const { origin, pathname, search } = new URL( target.url );
			url = `${ origin }/studio-auto-login?redirect_to=${ encodeURIComponent(
				pathname + search
			) }`;
		} else {
			url = target.url;
		}
		const response = await page.goto( url, {
			waitUntil: options.waitUntil ?? 'domcontentloaded',
			timeout: PAGE_LOAD_TIMEOUT_MS,
		} );
		if ( options.waitUntil !== 'networkidle' ) {
			await page
				.waitForLoadState( 'networkidle', { timeout: PAGE_SETTLE_TIMEOUT_MS } )
				.catch( () => {} );
		}
		statuses.set( page, response?.status() ?? 0 );
		return page;
	} catch ( error ) {
		await page.close().catch( () => {} );
		throw error;
	}
}

// The HTTP status of the page's own response; 0 for a rendered document.
export function pageStatus( page: Page ): number {
	return statuses.get( page ) ?? 0;
}

// Fetches a text resource, such as a site's robots.txt, without a page.
export async function fetchText( url: string ): Promise< { status: number; body: string } > {
	const browser = await getSharedBrowser();
	const context = await browser.newContext( { ignoreHTTPSErrors: true } );
	try {
		const response = await context.request.get( url, {
			failOnStatusCode: false,
			timeout: 10_000,
		} );
		return { status: response.status(), body: await response.text() };
	} finally {
		await context.close();
	}
}
