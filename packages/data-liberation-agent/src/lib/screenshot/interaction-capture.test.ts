import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { captureTriggeredDialogs, INTERACTION_STATES_SCHEMA } from './interaction-capture.js';
import { wireCapturedDialogs } from '../static-dialogs.js';

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
				expect( report.initialDialogs?.every( ( state ) => state.status === 'captured' ) ).toBe( true );
				expect( report.initialDialogs?.every( ( state ) => state.dismissal?.verified ) ).toBe( true );
				expect( await page.locator( '[role="dialog"]:visible' ).count() ).toBe( 1 );

				const portable = wireCapturedDialogs(
					'<!doctype html><html><head></head><body><main>Source page</main></body></html>',
					report.states,
					report.initialDialogs
				);
				expect( portable ).toContain( '<script data-dla-disclosure-runtime="true">' );
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
		'preserves an event-created navigation dialog without claiming a menu-shaped no-op',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 390, height: 844 } } );
			try {
				await page.setContent( `<!doctype html><body>
					<button id="site-menu" type="button" aria-label="Menu">Menu</button>
					<button id="no-op-menu" type="button" aria-label="Menu">Menu</button>
					<script>
						document.querySelector('#site-menu').addEventListener('click', () => {
							const menu = document.createElement('nav');
							menu.id = 'site-navigation';
							menu.className = 'captured-navigation';
							menu.setAttribute('aria-label', 'Site');
							menu.style.cssText = 'position:fixed;inset:0;background:white';
							menu.innerHTML = '<a href="/about">About</a><button type="button" aria-label="Close">Close</button>';
							menu.querySelector('button').addEventListener('click', () => menu.remove());
							document.body.append(menu);
						});
					</script>
				</body>` );

				const report = await captureTriggeredDialogs( page, 'https://example.test/' );
				expect( report.states ).toMatchObject( [
					{ status: 'captured', trigger: { id: 'site-menu', label: 'Menu' }, dialog: { id: 'site-navigation', tag: 'nav', ariaLabel: 'Site' } },
					{ status: 'no-dialog', trigger: { id: 'no-op-menu', label: 'Menu' } },
				] );

				const portable = wireCapturedDialogs(
					'<!doctype html><html><head><style>.captured-navigation{display:none}</style></head><body><button id="site-menu" type="button" aria-label="Menu">Menu</button><button id="no-op-menu" type="button" aria-label="Menu">Menu</button></body></html>',
					report.states
				);
				await page.setContent( portable );
				await page.locator( 'details.dla-disclosure summary' ).click();
				expect(
					await page
						.locator( 'details.dla-disclosure[open] [role="dialog"] a[href="/about"]' )
						.isVisible()
				).toBe( true );
				await page.keyboard.press( 'Escape' );
				expect(
					await page
						.locator( 'details.dla-disclosure' )
						.evaluate( ( element ) => ( element as HTMLDetailsElement ).open )
				).toBe( false );
				expect( await page.locator( '#no-op-menu' ).count() ).toBe( 1 );
			} finally {
				await browser.close();
			}
		},
		30_000
	);

	it.skipIf( process.env.SKIP_BROWSER_TESTS )(
		'dismisses portable triggered dialogs by close control and Escape without handling Escape elsewhere',
		async () => {
			const browser = await chromium.launch( { headless: true } );
			const page = await browser.newPage( { viewport: { width: 390, height: 844 } } );
			try {
				const portable = wireCapturedDialogs(
					'<!doctype html><html><head></head><body><input aria-label="Search"><button id="site-menu" aria-label="Menu">Menu</button></body></html>',
					[
						{
							status: 'captured',
							trigger: { selector: '#site-menu', id: 'site-menu', tag: 'button', ariaHaspopup: 'dialog', label: 'Menu', dataBindings: {} },
							dialog: {
								selector: '#site-navigation',
								tag: 'nav',
								ariaModal: true,
								ariaLabel: 'Site navigation',
								html: '<nav><a href="/">Home</a><a href="/quote">Get a Quote</a><a href="/contact">Contact</a></nav>',
								htmlBytes: 88,
								htmlTruncated: false,
							},
						},
					]
				);
				await page.setContent( portable );
				await page.waitForFunction( () => document.readyState === 'complete' );

				const disclosure = page.locator( 'details.dla-disclosure' );
				const summary = disclosure.locator( 'summary' );
				await summary.click();
				expect( await page.getByRole( 'link', { name: 'Home' } ).isVisible() ).toBe( true );
				expect( await page.getByRole( 'link', { name: 'Get a Quote' } ).isVisible() ).toBe( true );
				expect( await page.getByRole( 'link', { name: 'Contact' } ).isVisible() ).toBe( true );
				await page.waitForFunction( () =>
					document.querySelector( 'details.dla-disclosure > summary' )?.getAttribute( 'aria-label' ) === 'Close Menu'
				);
				expect( await summary.getAttribute( 'aria-label' ) ).toBe( 'Close Menu' );
				await summary.click();
				expect( await disclosure.evaluate( ( element ) => ( element as HTMLDetailsElement ).open ) ).toBe( false );
				expect( await page.evaluate( () => document.activeElement?.tagName ) ).toBe( 'SUMMARY' );

				await summary.click();
				await page.keyboard.press( 'Escape' );
				expect( await disclosure.evaluate( ( element ) => ( element as HTMLDetailsElement ).open ) ).toBe( false );
				expect( await page.evaluate( () => document.activeElement?.tagName ) ).toBe( 'SUMMARY' );

				await page.locator( 'input' ).focus();
				await page.evaluate( () => {
					document.addEventListener( 'keydown', ( event ) => {
						document.body.dataset.escapePrevented = String( event.defaultPrevented );
					}, { once: true } );
				} );
				await page.keyboard.press( 'Escape' );
				expect( await page.locator( 'body' ).getAttribute( 'data-escape-prevented' ) ).toBe( 'false' );

				await page.setContent( '<!doctype html><input aria-label="Normal page input">' );
				await page.evaluate( () => {
					document.addEventListener( 'keydown', ( event ) => {
						document.body.dataset.escapePrevented = String( event.defaultPrevented );
					}, { once: true } );
				} );
				await page.getByRole( 'textbox', { name: 'Normal page input' } ).focus();
				await page.keyboard.press( 'Escape' );
				expect( await page.locator( 'body' ).getAttribute( 'data-escape-prevented' ) ).toBe( 'false' );
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
