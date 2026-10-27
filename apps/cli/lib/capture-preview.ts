import { existsSync } from 'node:fs';
import { getSharedBrowser } from 'cli/ai/browser-utils';

/**
 * Screenshots a site page for `studio ui`'s stopped-site preview, on the
 * browser the AI tools share. Never downloads one: without Chromium installed
 * there is no screenshot.
 */
export async function capturePreview(
	url: string,
	size: { width: number; height: number }
): Promise< Buffer > {
	const { chromium } = await import( 'playwright' );
	if ( ! existsSync( chromium.executablePath() ) ) {
		throw new Error( 'Chromium is not installed.' );
	}
	const page = await ( await getSharedBrowser() ).newPage( { viewport: size } );
	try {
		await page.goto( url, { waitUntil: 'load', timeout: 5000 } );
		return await page.screenshot();
	} finally {
		await page.close();
	}
}
