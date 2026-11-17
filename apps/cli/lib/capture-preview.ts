import { existsSync } from 'node:fs';
import { openSharedPage } from '@studio/agent/node';

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
	const page = await openSharedPage( { viewport: size } );
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
