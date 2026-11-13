import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { chromium } from 'playwright';
import { afterAll, describe, expect, it } from 'vitest';
import {
	closeSharedBrowser,
	getSharedBrowser,
	openSharedPage,
} from '@studio/agent/node/browser-utils';

// A real Chromium to open pages on, when one is installed.
const CHROMIUM = existsSync( chromium.executablePath() ) && process.platform !== 'win32';

// The Chromium processes this test process launched.
const launchedChromium = () =>
	execFileSync( 'pgrep', [ '-P', String( process.pid ) ], { encoding: 'utf8' } )
		.split( '\n' )
		.filter( Boolean )
		.map( Number )
		.filter( ( pid ) =>
			/chrom/i.test(
				execFileSync( 'ps', [ '-o', 'comm=', '-p', String( pid ) ], { encoding: 'utf8' } )
			)
		);

describe.runIf( CHROMIUM )( 'opening a page on the shared browser', () => {
	afterAll( closeSharedBrowser );

	// port eval39 grooming 2: Chrome under load answered none of a new page's
	// setup commands, and the checks waiting on the page waited 35 minutes.
	it( 'gives up on a browser that opens no page, and opens the next page on another', async () => {
		const stuck = await getSharedBrowser();
		const [ pid ] = launchedChromium();
		process.kill( pid, 'SIGSTOP' );
		try {
			await expect( openSharedPage() ).rejects.toThrow(
				'Opening a browser page timed out after 30s'
			);
		} finally {
			process.kill( pid, 'SIGKILL' );
		}
		const page = await openSharedPage();
		expect( page.context().browser() ).not.toBe( stuck );
		await page.close();
	}, 90000 );
} );
