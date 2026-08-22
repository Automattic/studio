import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { captureTriggeredDialogs, INTERACTION_STATES_SCHEMA } from './interaction-capture.js';

describe( 'captureTriggeredDialogs', () => {
	it.skipIf( process.env.SKIP_BROWSER_TESTS )( 'captures a bounded inert snapshot after a dialog trigger click', async () => {
		const browser = await chromium.launch( { headless: true } );
		const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
		try {
			await page.setContent( `<!doctype html><body>
				<button aria-haspopup="dialog" data-modalid="signup">Contact</button>
				<a href="/account" aria-haspopup="dialog">Account</a>
				<script>
					document.querySelector('button').addEventListener('click', () => {
						const dialog = document.createElement('div');
						dialog.id = 'signup';
						dialog.setAttribute('role', 'dialog');
						dialog.setAttribute('aria-modal', 'true');
						dialog.setAttribute('aria-label', 'Contact');
						dialog.innerHTML = '<form onclick="unsafe()"><input name="name" placeholder="Name"><iframe src="https://third-party.invalid"></iframe><button type="button" aria-label="Close">Close</button></form>';
						document.body.append(dialog);
						document.addEventListener('keydown', event => { if (event.key === 'Escape') dialog.remove(); }, { once: true });
					});
				</script>
			</body>` );

			const report = await captureTriggeredDialogs( page, 'https://example.test/' );
			expect( report.schema ).toBe( INTERACTION_STATES_SCHEMA );
			expect( report.states ).toHaveLength( 1 );
			expect( report.states[ 0 ] ).toMatchObject( {
				status: 'captured',
				trigger: {
					ariaHaspopup: 'dialog',
					dataBindings: { 'data-modalid': 'signup' },
				},
				dialog: { id: 'signup', role: 'dialog', ariaModal: true, ariaLabel: 'Contact' },
			} );
			const html = report.states[ 0 ].dialog?.html ?? '';
			expect( html ).toContain( 'placeholder="Name"' );
			expect( html ).not.toContain( '<iframe' );
			expect( html ).not.toContain( 'onclick=' );
			expect( await page.locator( '[data-lib-interaction-trigger],[data-lib-interaction-dialog]' ).count() ).toBe( 0 );
		} finally {
			await browser.close();
		}
	}, 30_000 );
} );
