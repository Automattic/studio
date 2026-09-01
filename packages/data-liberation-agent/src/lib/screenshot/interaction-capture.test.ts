import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { wireCapturedDialogs } from '../static-dialogs.js';
import { captureTriggeredDialogs, INTERACTION_STATES_SCHEMA } from './interaction-capture.js';

describe( 'captureTriggeredDialogs', () => {
	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'captures initially visible dialogs with verified native dismissal and bounds probes',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><body>
					<script>
						for (let index = 0; index < 9; index++) {
							const dialog = document.createElement('div');
							dialog.id = 'automatic-' + index;
							dialog.setAttribute('role', 'dialog');
							dialog.setAttribute('aria-modal', 'true');
							dialog.setAttribute('aria-label', 'Automatic ' + index);
							dialog.innerHTML = '<p>Automatic popup ' + index + '</p><button id="close-' + index + '" type="button" aria-label="Close automatic ' + index + '">Close</button>';
							dialog.querySelector('button').addEventListener('click', () => { dialog.style.display = 'none'; });
							document.body.append(dialog);
						}
					</script>
				</body>` );

				const report = await captureTriggeredDialogs( page, 'https://example.test/' );
				expect( report.schema ).toBe( INTERACTION_STATES_SCHEMA );
				expect( report.initialDialogs ).toHaveLength( 8 );
				expect( report.initialDialogs?.every( ( state ) => state.initiallyVisible ) ).toBe( true );
				expect( report.initialDialogs?.every( ( state ) => state.status === 'captured' ) ).toBe(
					true
				);
				expect( report.initialDialogs?.every( ( state ) => state.dismissal?.verified ) ).toBe(
					true
				);
				expect( await page.locator( '[role="dialog"]:visible' ).count() ).toBe( 1 );

				const portable = wireCapturedDialogs(
					'<!doctype html><html><head></head><body><main>Source page</main></body></html>',
					report.states,
					report.initialDialogs
				);
				expect( portable ).not.toContain( '<script' );
				await page.setContent( portable );
				expect( await page.locator( 'details.dla-initial-dialog[open]' ).count() ).toBe( 8 );
				expect( await page.getByText( 'Automatic popup 7' ).isVisible() ).toBe( true );
				await page.locator( 'details.dla-initial-dialog' ).last().locator( 'summary' ).click();
				expect(
					await page
						.locator( 'details.dla-initial-dialog' )
						.last()
						.evaluate( ( details ) => ( details as HTMLDetailsElement ).open )
				).toBe( false );
				expect( await page.getByText( 'Automatic popup 7' ).isVisible() ).toBe( false );
			} finally {
				await browser.close();
			}
		},
		30_000
	);

	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'discovers an unbound dialog trigger',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><body>
				<button type="button" aria-haspopup="dialog" aria-label="Open Site Navigation">Menu</button>
				<script>
					document.querySelector('button').addEventListener('click', () => {
						const dialog = document.createElement('dialog');
						dialog.id = 'site-navigation';
						dialog.setAttribute('role', 'dialog');
						dialog.innerHTML = '<button type="button" aria-label="Close">Close</button>';
						dialog.addEventListener('cancel', () => dialog.remove());
						document.body.append(dialog);
						dialog.showModal();
					});
				</script>
			</body>` );

				const report = await captureTriggeredDialogs( page, 'https://example.test/' );
				expect( report.states ).toHaveLength( 1 );
				expect( report.states[ 0 ] ).toMatchObject( {
					status: 'captured',
					trigger: { tag: 'button', ariaHaspopup: 'dialog', dataBindings: {} },
					dialog: { id: 'site-navigation', tag: 'dialog', role: 'dialog' },
				} );
			} finally {
				await browser.close();
			}
		},
		30_000
	);

	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'captures a bounded inert snapshot after a dialog trigger click',
		async () => {
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
				expect(
					await page
						.locator( '[data-lib-interaction-trigger],[data-lib-interaction-dialog]' )
						.count()
				).toBe( 0 );
			} finally {
				await browser.close();
			}
		},
		30_000
	);

	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'only clicks the first eight unambiguous dialog triggers',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
			try {
				await page.setContent( `<!doctype html><body>
				<div id="candidates"></div>
				<button id="ambiguous" aria-haspopup="true">Ambiguous popup</button>
				<button id="menu" aria-haspopup="menu">Menu</button>
				<button id="disabled" aria-haspopup="dialog" aria-disabled="true">Disabled</button>
				<a id="navigation" href="/account" aria-haspopup="dialog">Account</a>
				<script>
					window.clicked = [];
					const candidates = document.querySelector('#candidates');
					for (let index = 0; index < 10; index++) {
						const button = document.createElement('button');
						button.id = 'candidate-' + index;
						button.setAttribute('aria-haspopup', 'dialog');
						button.textContent = 'Candidate ' + index;
						button.addEventListener('click', () => {
							window.clicked.push(button.id);
							const dialog = document.createElement('dialog');
							dialog.id = 'dialog-' + index;
							dialog.setAttribute('role', 'dialog');
							dialog.innerHTML = '<button type="button" aria-label="Close">Close</button>';
							dialog.addEventListener('cancel', () => dialog.remove());
							document.body.append(dialog);
							dialog.showModal();
						});
						candidates.append(button);
					}
					for (const id of ['ambiguous', 'menu', 'disabled', 'navigation']) {
						document.querySelector('#' + id).addEventListener('click', event => {
							event.preventDefault();
							window.clicked.push(id);
						});
					}
				</script>
			</body>` );

				const report = await captureTriggeredDialogs( page, 'https://example.test/' );
				const clicked = await page.evaluate(
					() => ( window as typeof window & { clicked: string[] } ).clicked
				);

				expect( report.states ).toHaveLength( 8 );
				expect( report.states.every( ( state ) => state.status === 'captured' ) ).toBe( true );
				expect( clicked ).toEqual(
					Array.from( { length: 8 }, ( _, index ) => `candidate-${ index }` )
				);
			} finally {
				await browser.close();
			}
		},
		30_000
	);
} );
