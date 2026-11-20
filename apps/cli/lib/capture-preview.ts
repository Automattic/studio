import { existsSync } from 'node:fs';
import { getSharedBrowser } from '@studio/agent/node';

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
	// A hosted `studio serve` serves its sites to itself with a certificate only it trusts.
	const page = await (
		await getSharedBrowser()
	).newPage( {
		viewport: size,
		ignoreHTTPSErrors: !! process.env.STUDIO_CA_BUNDLE,
	} );
	try {
		await page.goto( new URL( '/?studio-hide-adminbar', url ).href, {
			waitUntil: 'load',
			timeout: 5000,
		} );
		await page.addStyleTag( {
			content: '#wpadminbar { display: none !important; } html { margin-top: 0 !important; }',
		} );
		return await page.screenshot();
	} finally {
		await page.close();
	}
}
