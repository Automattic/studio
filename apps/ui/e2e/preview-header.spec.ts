import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { packagedApp } from './packaged-app';

async function command( page: Page, name: string ) {
	await page.keyboard.press( 'ControlOrMeta+k' );
	const palette = page.getByRole( 'dialog', { name: 'Command palette' } );
	await palette.getByRole( 'combobox' ).fill( name );
	await palette.getByRole( 'option' ).filter( { hasText: name } ).first().click();
}

async function reloadPreview( page: Page ) {
	await expect( page.locator( '[data-site-header-actions]' ) ).toHaveAttribute(
		'data-site-header-actions',
		'inline'
	);
	const button = page.getByRole( 'button', { name: 'Reload preview', exact: true } );
	if ( await button.isVisible() ) await button.click();
	else {
		await page.getByRole( 'button', { name: 'More preview actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Reload preview', exact: true } ).click();
	}
}

async function toggleSidebar( page: Page ) {
	await expect( async () => {
		for ( const toggle of await page
			.getByRole( 'button', { name: /^(Hide|Show) sidebar$/ } )
			.all() ) {
			const onTop = await toggle.evaluate( ( element ) => {
				const rect = element.getBoundingClientRect();
				return (
					rect.width > 0 &&
					element.contains(
						document.elementFromPoint( rect.x + rect.width / 2, rect.y + rect.height / 2 )
					)
				);
			} );
			if ( onTop ) return await toggle.click( { timeout: 2000 } );
		}
		throw new Error( 'No sidebar toggle is reachable' );
	} ).toPass();
}

async function checkGeometry( page: Page, ignoreOverlap = false ) {
	await expect
		.poll( () =>
			page.evaluate( ( ignoreOverlap ) => {
				const header = [ ...document.querySelectorAll< HTMLElement >( 'header' ) ].find(
					( element ) =>
						! element.closest( '[inert]' ) &&
						element.getBoundingClientRect().width > 0 &&
						element.hasAttribute( 'data-site-header' )
				);
				const address = document.querySelector< HTMLElement >( '[data-site-header-address]' );
				const actions = document.querySelector< HTMLElement >( '[data-site-header-actions]' )!;
				const controls = [
					...document.querySelectorAll< HTMLElement >(
						'[data-site-header-navigation], [data-site-header-address], [data-site-header-annotate], [data-site-header-publish], [data-site-header-lifecycle], [data-site-header-trailing], [data-sidebar-toggle], [data-header-actions] button'
					),
				].filter(
					( element ) =>
						! element.closest( '[inert]' ) &&
						getComputedStyle( element ).visibility !== 'hidden' &&
						element.getBoundingClientRect().width
				);
				const rects = controls
					.map( ( element ) => element.getBoundingClientRect() )
					.sort( ( a, b ) => a.x - b.x );
				return {
					height: Math.round( header?.getBoundingClientRect().height ?? 0 ),
					buttonHeights: [
						...new Set(
							[
								...document.querySelectorAll< HTMLElement >(
									'[data-site-header] button:not([data-site-header-address] button), [data-site-header-actions] button, [data-sidebar-toggle], [data-header-actions] button'
								),
							]
								.filter(
									( element ) =>
										! element.closest( '[inert]' ) &&
										getComputedStyle( element ).visibility !== 'hidden' &&
										element.getBoundingClientRect().width
								)
								.map( ( element ) => Math.round( element.getBoundingClientRect().height ) )
						),
					],
					overlap:
						! ignoreOverlap &&
						rects.some( ( rect, index ) => index && rects[ index - 1 ].right > rect.left + 1 ),
					clipped: rects.some( ( rect ) => rect.left < 0 || rect.right > innerWidth + 1 ),
					scroll: actions.scrollWidth > actions.clientWidth + 1,
					address:
						! address ||
						Boolean( address.closest( '[inert]' ) ) ||
						address.getBoundingClientRect().width >=
							( actions.dataset.siteHeaderActions === 'inline' ? 71 : 0 ),
				};
			}, ignoreOverlap )
		)
		.toEqual( {
			height: 54,
			buttonHeights: [ 36 ],
			overlap: false,
			clipped: false,
			scroll: false,
			address: true,
		} );
}

for ( const host of [ 'browser', 'desktop' ] as const ) {
	test( `preview header layout and lifecycle in the ${ host } host`, async ( {
		page: browserPage,
	}, info ) => {
		test.setTimeout( 300_000 );
		const directory = await mkdtemp( path.join( tmpdir(), 'sh-' ) );
		const config = path.join( directory, 'config' );
		const home = path.join( directory, 'home' );
		await mkdir( config );
		await mkdir( home );
		await mkdir( path.join( directory, 'daemon' ) );
		await writeFile(
			path.join( config, 'shared.json' ),
			JSON.stringify( {
				version: 1,
				analyticsOptOut: true,
				aiProvider: 'anthropic-api-key',
				anthropicApiKey: 'sk-ant-isolated-header-test',
			} )
		);
		await writeFile(
			path.join( config, 'app.json' ),
			JSON.stringify( {
				version: 1,
				siteMetadata: {},
				onboardingCompleted: true,
				onboardingHints: {
					tourDismissedVersion: Number.MAX_SAFE_INTEGER,
					whatsNewSeenVersion: Number.MAX_SAFE_INTEGER,
				},
				devToolsOpen: false,
				colorScheme: 'light',
				newSiteBehavior: 'blank',
				defaultSiteDirectory: directory,
				quitSitesBehavior: 'stop',
				cliUserUninstalled: true,
				lastNightlyUpdateCheck: Date.now(),
				nightlyPromptResult: { response: 'no', dontAskAgain: true },
			} )
		);
		const env = {
			...process.env,
			DEV_CONFIG_DIR: config,
			STUDIO_PROCESS_MANAGER_HOME: path.join( directory, 'daemon' ),
		};
		const port = await portFinder.getOpenPort();
		const origin = `http://localhost:${ port }`;
		const server = spawn(
			process.execPath,
			[ 'apps/cli/dist/cli/main.mjs', 'ui', '--no-open', '--port', String( port ) ],
			{
				cwd: path.resolve( import.meta.dirname, '../../..' ),
				env,
				stdio: [ 'ignore', 'pipe', 'pipe' ],
			}
		);
		let logs = '';
		server.stdout.on( 'data', ( chunk ) => ( logs += String( chunk ) ) );
		server.stderr.on( 'data', ( chunk ) => ( logs += String( chunk ) ) );
		let app: ElectronApplication | undefined;
		let page = browserPage;
		const sites: { id: string; url: string }[] = [];
		const releaseRequests: ( () => void )[] = [];
		try {
			await expect
				.poll( async () => {
					try {
						return ( await browserPage.request.get( `${ origin }/api/health` ) ).ok();
					} catch {
						return false;
					}
				} )
				.toBe( true );
			if ( host === 'desktop' ) {
				const desktopEnv: Record< string, string > = {
					...env,
					IS_DEV_BUILD: '1',
					E2E: 'true',
					E2E_HOME_PATH: home,
					E2E_APP_DATA_PATH: path.join( directory, 'appData' ),
				};
				delete desktopEnv.ELECTRON_RENDERER_URL;
				delete desktopEnv.ELECTRON_UI_RENDERER_URL;
				delete desktopEnv.ELECTRON_EXPERIMENTAL_RENDERER_URL;
				app = await electron.launch( {
					...packagedApp( [ `--user-data-dir=${ path.join( directory, 'electron' ) }` ] ),
					env: desktopEnv,
				} );
				app.process().stderr?.on( 'data', ( chunk ) => ( logs += String( chunk ) ) );
				page = await app.firstWindow();
				await page.emulateMedia( { colorScheme: null } );
			} else await page.goto( origin );
			const setWidth = async ( width: number ) => {
				if ( app )
					await app.evaluate( ( { BrowserWindow }, value ) => {
						const window = BrowserWindow.getAllWindows()[ 0 ];
						window.webContents.setZoomFactor( 1 );
						window.setSize( value, 900 );
					}, width );
				else await page.setViewportSize( { width, height: 900 } );
			};
			const holdPreview = async ( fail = false, site = sites[ 0 ] ) => {
				if ( app ) {
					await app.evaluate( ( { session }, url ) => {
						const state = globalThis as typeof globalThis & {
							headerPreviewCallbacks: ( ( response: { cancel?: boolean } ) => void )[];
						};
						state.headerPreviewCallbacks = [];
						session
							.fromPartition( 'persist:site-preview' )
							.webRequest.onBeforeRequest( { urls: [ '<all_urls>' ] }, ( details, callback ) => {
								if ( details.resourceType === 'mainFrame' && details.url.startsWith( url ) )
									state.headerPreviewCallbacks.push( callback );
								else callback( {} );
							} );
					}, new URL( site.url ).origin );
					return {
						wait: () =>
							expect
								.poll( () =>
									app!.evaluate(
										() =>
											( globalThis as typeof globalThis & { headerPreviewCallbacks: unknown[] } )
												.headerPreviewCallbacks.length
									)
								)
								.toBeGreaterThan( 0 ),
						release: () =>
							app!.evaluate( ( { session }, cancel ) => {
								session.fromPartition( 'persist:site-preview' ).webRequest.onBeforeRequest( null );
								for ( const callback of (
									globalThis as typeof globalThis & {
										headerPreviewCallbacks: ( ( response: { cancel: boolean } ) => void )[];
									}
								 ).headerPreviewCallbacks.splice( 0 ) )
									callback( { cancel } );
							}, fail ),
					};
				}
				let requested = false;
				let release!: () => void;
				const waiting = new Promise< void >( ( resolve ) => {
					release = resolve;
				} );
				releaseRequests.push( release );
				await page.route(
					`${ new URL( site.url ).origin }/**`,
					async ( route ) => {
						requested = true;
						await waiting;
						if ( fail ) await route.abort();
						else await route.continue();
					},
					{ times: 1 }
				);
				return {
					wait: () => expect.poll( () => requested ).toBe( true ),
					release: async () => {
						release();
					},
				};
			};
			const failLifecycle = async ( operation: 'start' | 'stop' ) => {
				if ( app ) {
					await app.evaluate( ( { ipcMain }, action ) => {
						const state = globalThis as typeof globalThis & {
							releaseHeaderOperation?: () => void;
						};
						state.releaseHeaderOperation = undefined;
						const channel = action === 'start' ? 'startServer' : 'stopServer';
						const original = (
							ipcMain as unknown as {
								_invokeHandlers: Map< string, ( ...args: unknown[] ) => unknown >;
							}
						 )._invokeHandlers.get( channel )!;
						ipcMain.removeHandler( channel );
						ipcMain.handle( channel, async () => {
							ipcMain.removeHandler( channel );
							ipcMain.handle( channel, original );
							await new Promise< void >( ( resolve ) => {
								state.releaseHeaderOperation = resolve;
							} );
							throw new Error( `Isolated ${ action } failure` );
						} );
					}, operation );
					return async () => {
						await expect
							.poll( () =>
								app!.evaluate( () =>
									Boolean(
										( globalThis as typeof globalThis & { releaseHeaderOperation?: () => void } )
											.releaseHeaderOperation
									)
								)
							)
							.toBe( true );
						await app!.evaluate( () =>
							(
								globalThis as typeof globalThis & { releaseHeaderOperation: () => void }
							 ).releaseHeaderOperation()
						);
					};
				}
				let finish!: () => void;
				const waiting = new Promise< void >( ( resolve ) => {
					finish = resolve;
				} );
				releaseRequests.push( finish );
				await page.route(
					`**/api/sites/${ sites[ 0 ].id }/${ operation }`,
					async ( route ) => {
						await waiting;
						await route.fulfill( {
							status: 500,
							json: { error: `Isolated ${ operation } failure` },
						} );
					},
					{ times: 1 }
				);
				return async () => {
					finish();
				};
			};
			await setWidth( 1440 );
			const add = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
			await expect( add ).toBeVisible();
			await expect( page.locator( '[data-site-header-publish] button' ) ).toHaveCount( 0 );
			await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toHaveCount( 0 );
			await add.getByRole( 'button', { name: 'Close Add site' } ).click();
			for ( const name of [ 'Header one', 'Header two' ] ) {
				const response = await browserPage.request.post( `${ origin }/api/sites`, {
					data: { name, path: path.join( directory, name ), runtime: 'native-php' },
					timeout: 120_000,
				} );
				expect( response.ok(), await response.text() ).toBe( true );
				sites.push( await response.json() );
			}
			if ( app ) {
				await page.evaluate( async ( siteId ) => {
					await window.ipcApi.getSiteDetails();
					const chat = await window.ipcApi.createAiSession( siteId );
					await window.ipcApi.updateAiSessionMetadata( chat.id, { title: 'Header chat' } );
				}, sites[ 0 ].id );
			} else {
				const chat = await browserPage.request.post( `${ origin }/api/sessions`, {
					data: { siteId: sites[ 0 ].id },
				} );
				const session = ( await chat.json() ) as { id: string };
				await browserPage.request.patch( `${ origin }/api/sessions/${ session.id }`, {
					data: { title: 'Header chat' },
				} );
			}
			let releaseData!: () => void;
			if ( app )
				await app.evaluate( ( { ipcMain } ) => {
					const handlers = (
						ipcMain as unknown as {
							_invokeHandlers: Map< string, ( ...args: unknown[] ) => unknown >;
						}
					 )._invokeHandlers;
					const original = handlers.get( 'getSiteDetails' )!;
					const state = globalThis as typeof globalThis & { releaseHeaderData: () => void };
					const waiting = new Promise< void >( ( resolve ) => {
						state.releaseHeaderData = resolve;
					} );
					ipcMain.removeHandler( 'getSiteDetails' );
					ipcMain.handle( 'getSiteDetails', async ( ...args ) => {
						await waiting;
						return original( ...args );
					} );
				} );
			else {
				const waiting = new Promise< void >( ( resolve ) => {
					releaseData = resolve;
				} );
				await page.route( '**/api/sites', async ( route ) => {
					await waiting;
					await route.continue();
				} );
			}
			await page.evaluate( () =>
				location.hash ? ( location.hash = '#/' ) : history.replaceState( null, '', '/' )
			);
			await page.reload( { waitUntil: 'domcontentloaded' } );
			if ( app )
				await app.evaluate( () =>
					(
						globalThis as typeof globalThis & { releaseHeaderData: () => void }
					 ).releaseHeaderData()
				);
			else {
				releaseData();
			}
			await page.getByRole( 'button', { name: 'Header one', exact: true } ).click();
			const annotate = page.getByRole( 'button', { name: 'Annotate', exact: true } );
			if ( app ) await expect( annotate ).toBeVisible();
			if ( app ) {
				const guest = await page
					.locator( 'webview' )
					.evaluate( ( element ) =>
						( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
					);
				await expect
					.poll( () =>
						app!.evaluate(
							( { webContents }, id ) =>
								webContents.fromId( id )!.executeJavaScript( 'document.body.innerText' ),
							guest
						)
					)
					.toContain( 'Hello world!' );
			} else
				await expect(
					page
						.frameLocator( 'iframe' )
						.getByRole( 'link', { name: 'Hello world!', exact: true } )
						.first()
				).toBeVisible();
			await page.getByRole( 'button', { name: 'Header chat', exact: true } ).first().click();
			const draft = page.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
			await draft.fill( 'Preserve this header verification draft' );
			const actions = page.locator( '[data-site-header-actions]' );
			const publish = page.locator( '[data-site-header-publish] button' );
			const publishElement = await publish.elementHandle();
			const previewElement = await page
				.getByRole( 'complementary', { name: 'Site preview' } )
				.locator( app ? 'webview' : 'iframe' )
				.elementHandle();
			for ( const scheme of [ 'light', 'dark' ] as const ) {
				if (
					( await page
						.locator( 'html' )
						.evaluate( ( element ) => element.dataset.colorScheme === 'dark' ) ) !==
					( scheme === 'dark' )
				) {
					await command( page, scheme === 'light' ? 'Use light mode' : 'Use dark mode' );
				}
				await expect
					.poll( () =>
						page.locator( 'html' ).evaluate( ( element ) => element.dataset.colorScheme === 'dark' )
					)
					.toBe( scheme === 'dark' );
				await setWidth( 1440 );
				const address = page.getByRole( 'textbox', { name: 'Address' } );
				await address.hover();
				const addressActions = page.locator(
					'[data-site-header-address] [class*="_actions_"] button'
				);
				await expect( addressActions ).toHaveCount( 2 );
				const fieldBounds = ( await address.locator( '..' ).boundingBox() )!;
				for ( const action of await addressActions.all() ) {
					const bounds = ( await action.boundingBox() )!;
					expect( bounds.height ).toBe( 32 );
					expect( bounds.y - fieldBounds.y ).toBe( 2 );
					expect( bounds.x - fieldBounds.x ).toBeGreaterThanOrEqual( 2 );
					expect(
						fieldBounds.x + fieldBounds.width - bounds.x - bounds.width
					).toBeGreaterThanOrEqual( 2 );
				}
				await addressActions.first().hover();
				await page.screenshot( {
					animations: 'disabled',
					path: info.outputPath( `${ host }-${ scheme }-full.png` ),
				} );
			}
			for ( const scheme of [ 'light', 'dark' ] as const ) {
				if (
					( await page
						.locator( 'html' )
						.evaluate( ( element ) => element.dataset.colorScheme === 'dark' ) ) !==
					( scheme === 'dark' )
				) {
					if (
						( await page
							.locator( 'html' )
							.evaluate( ( element ) => element.dataset.colorScheme === 'dark' ) ) !==
						( scheme === 'dark' )
					) {
						await command( page, scheme === 'light' ? 'Use light mode' : 'Use dark mode' );
					}
					await expect
						.poll( () =>
							page
								.locator( 'html' )
								.evaluate( ( element ) => element.dataset.colorScheme === 'dark' )
						)
						.toBe( scheme === 'dark' );
					await expect
						.poll( () =>
							page
								.locator( 'html' )
								.evaluate( ( element ) => element.dataset.colorScheme === 'dark' )
						)
						.toBe( scheme === 'dark' );
				}
				await setWidth( 1440 );
				if (
					( await page
						.getByRole( 'button', { name: /^(Hide|Show) sidebar$/ } )
						.first()
						.getAttribute( 'aria-expanded' ) ) !== 'true'
				) {
					await toggleSidebar( page );
				}
				await page.getByRole( 'separator', { name: 'Resize site preview' } ).press( 'End' );
				await expect( actions ).toHaveAttribute( 'data-site-header-actions', 'inline' );
				if ( app ) await expect( annotate ).toHaveText( 'Annotate' );
				await expect( page.getByRole( 'button', { name: 'Share', exact: true } ) ).toHaveText( '' );
				await checkGeometry( page );

				if ( app ) await annotate.focus();
				await setWidth( 1020 );
				await expect( actions ).toHaveAttribute(
					'data-site-header-actions',
					'navigation-overflow'
				);
				const more = page.getByRole( 'button', { name: 'More preview actions' } );
				if ( app ) await expect( annotate ).toBeFocused();
				if ( app ) await expect( annotate ).toBeVisible();
				if ( app ) await expect( annotate ).toHaveText( '' );
				await expect( page.getByRole( 'button', { name: 'Back', exact: true } ) ).toBeHidden();
				await more.click();
				await expect( page.getByRole( 'menuitemcheckbox', { name: 'Annotate' } ) ).toHaveCount( 0 );
				await expect( page.getByRole( 'menuitem', { name: /Back/ } ) ).toBeVisible();
				await expect(
					page.getByRole( 'menuitem', { name: 'Site settings', exact: true } )
				).toBeVisible();
				await expect(
					page.getByRole( 'menuitem', { name: 'Open in browser', exact: true } )
				).toBeVisible();
				await expect(
					page.locator( '[data-site-header-address] [class*="_actions_"] button' )
				).toHaveCount( 0 );
				await expect( page.getByRole( 'menuitem', { name: 'Share', exact: true } ) ).toBeVisible();
				await page.screenshot( {
					animations: 'disabled',
					path: info.outputPath( `${ host }-${ scheme }-overflow.png` ),
				} );
				await page.keyboard.press( 'Escape' );
				await checkGeometry( page );
				await more.click();
				await page.getByRole( 'menuitem', { name: 'Share', exact: true } ).click();
				const sharing = page.getByRole( 'dialog', { name: 'Share', exact: true } );
				await expect( sharing ).toBeVisible();
				await page.keyboard.press( 'Escape' );
				await expect( sharing ).toBeHidden();
				await expect( more ).toBeFocused();
				await expect( draft ).toHaveValue( 'Preserve this header verification draft' );
				await expect
					.poll( () => publishElement!.evaluate( ( element ) => element.isConnected ) )
					.toBe( true );
				await expect
					.poll( () => previewElement!.evaluate( ( element ) => element.isConnected ) )
					.toBe( true );
				await setWidth( host === 'browser' ? 600 : 800 );
				if ( app ) {
					await expect
						.poll( () =>
							app!.evaluate(
								( { BrowserWindow } ) => BrowserWindow.getAllWindows()[ 0 ].getMinimumSize()[ 0 ]
							)
						)
						.toBe( 800 );
					await publish
						.locator( 'span' )
						.first()
						.evaluate( ( element ) => {
							element.textContent = 'Website veröffentlichen';
						} );
					const divider = page.getByRole( 'separator', { name: 'Resize site preview' } );
					await divider.focus();
					for ( let i = 0; i < 10; i++ ) await page.keyboard.press( 'ArrowRight' );
				}
				await expect( actions ).toHaveAttribute(
					'data-site-header-actions',
					'navigation-overflow'
				);
				await more.click();
				await expect( page.getByRole( 'menuitem', { name: /Back/ } ) ).toBeVisible();
				await expect( page.getByRole( 'menuitem', { name: 'Reload preview' } ) ).toBeVisible();
				await page.screenshot( {
					animations: 'disabled',
					path: info.outputPath( `${ host }-${ scheme }-narrow.png` ),
				} );
				await page.keyboard.press( 'Escape' );
				await checkGeometry( page, Boolean( app ) );
				const address = page.getByRole( 'textbox', { name: 'Address' } );
				const addressBounds = await address.boundingBox();
				await toggleSidebar( page );
				await expect( page.locator( '[class*="_sidebarOverlay_"]' ) ).toHaveCount( 1 );
				await expect( address ).toBeVisible();
				await expect.poll( () => address.boundingBox() ).toEqual( addressBounds );
				await expect( publish ).toBeVisible();
				await checkGeometry( page, Boolean( app ) );
				await toggleSidebar( page );
				await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
				if ( ! app ) {
					await setWidth( 390 );
					await checkGeometry( page, true );
					await page.screenshot( {
						animations: 'disabled',
						path: info.outputPath( `${ host }-${ scheme }-390.png` ),
					} );
				}
				if ( app )
					await publish
						.locator( 'span' )
						.first()
						.evaluate( ( element ) => {
							element.textContent = 'Publish';
						} );
				await setWidth( 1440 );
				await command( page, 'Hide preview' );
				await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toHaveCount( 0 );
				await expect( publish ).toBeHidden();
				if ( app ) await expect( annotate ).toBeHidden();
				await expect( page.getByRole( 'button', { name: 'Stop', exact: true } ) ).toBeVisible();
				await page.screenshot( { path: info.outputPath( `${ host }-${ scheme }-chat.png` ) } );
				await checkGeometry( page );
				await command( page, 'Show preview' );
				await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
				await command( page, 'Hide chat' );
				await checkGeometry( page );
				await toggleSidebar( page );
				await checkGeometry( page );
				await toggleSidebar( page );
				await checkGeometry( page );
				await command( page, 'Show chat' );
				await expect( draft ).toHaveValue( 'Preserve this header verification draft' );
			}
			if (
				( await page
					.getByRole( 'button', { name: /^(Hide|Show) sidebar$/ } )
					.first()
					.getAttribute( 'aria-expanded' ) ) !== 'true'
			) {
				await toggleSidebar( page );
			}
			await publish.click();
			const publishDialog = page.getByRole( 'dialog' );
			await expect( publishDialog ).toBeVisible();
			const publishDialogElement = await publishDialog.elementHandle();
			await setWidth( 1020 );
			await expect
				.poll( () => publishDialogElement!.evaluate( ( element ) => element.isConnected ) )
				.toBe( true );
			await page.keyboard.press( 'Escape' );
			await expect( publishDialog ).toBeHidden();
			await setWidth( 1440 );
			for ( const failed of [ false, true ] ) {
				const gate = await holdPreview( failed );
				await reloadPreview( page );
				await gate.wait();
				if ( app ) await expect( annotate ).toBeVisible();
				if ( app ) await expect( annotate ).toBeDisabled();
				await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();

				await gate.release();
				if ( failed ) {
					if ( app ) await expect( annotate ).toBeVisible();
					if ( app ) await expect( annotate ).toBeDisabled();
					await reloadPreview( page );
				}
				if ( app ) await expect( annotate ).toBeVisible();
				if ( app ) await expect( annotate ).toBeEnabled();
				await expect( draft ).toHaveValue( 'Preserve this header verification draft' );
			}
			const switchPreview = await holdPreview( false, sites[ 1 ] );
			await page.getByRole( 'button', { name: 'Header two', exact: true } ).click();
			await switchPreview.wait();
			if ( app ) await expect( annotate ).toBeVisible();
			if ( app ) await expect( annotate ).toBeDisabled();
			await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
				sites[ 1 ].url.replace( /\/$/, '' )
			);
			await switchPreview.release();
			if ( app ) await expect( annotate ).toBeVisible();
			await page.getByRole( 'button', { name: 'Header one', exact: true } ).click();
			await expect( draft ).toHaveValue( 'Preserve this header verification draft' );
			const lifecyclePublishElement = await publish.elementHandle();
			const failStop = await failLifecycle( 'stop' );
			await page.getByRole( 'button', { name: 'Stop', exact: true } ).click();
			await expect( page.getByRole( 'complementary', { name: 'Site preview' } ) ).toBeHidden();
			if ( app ) await expect( annotate ).toBeHidden();
			await expect( publish ).toBeHidden();
			await failStop();
			await expect(
				page.getByRole( 'button', { name: 'Stop Header one', exact: true } )
			).toBeEnabled();
			await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toBeVisible();
			await page.getByRole( 'button', { name: 'Stop', exact: true } ).click();
			await expect(
				page.getByRole( 'button', { name: 'Start Header one', exact: true } )
			).toBeEnabled();
			if ( app ) await expect( annotate ).toBeHidden();
			await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toHaveCount( 0 );
			await expect( publish ).toBeHidden();
			await expect( page.getByRole( 'button', { name: 'Start', exact: true } ) ).toBeEnabled();
			await checkGeometry( page );
			for ( const scheme of [ 'light', 'dark' ] ) {
				if (
					( await page
						.locator( 'html' )
						.evaluate( ( element ) => element.dataset.colorScheme === 'dark' ) ) !==
					( scheme === 'dark' )
				)
					if (
						( await page
							.locator( 'html' )
							.evaluate( ( element ) => element.dataset.colorScheme === 'dark' ) ) !==
						( scheme === 'dark' )
					) {
						await command( page, scheme === 'light' ? 'Use light mode' : 'Use dark mode' );
					}
				await expect
					.poll( () =>
						page.locator( 'html' ).evaluate( ( element ) => element.dataset.colorScheme === 'dark' )
					)
					.toBe( scheme === 'dark' );
				await expect
					.poll( () =>
						page.locator( 'html' ).evaluate( ( element ) => element.dataset.colorScheme === 'dark' )
					)
					.toBe( scheme === 'dark' );
				await checkGeometry( page );
				await page.screenshot( {
					animations: 'disabled',
					path: info.outputPath( `${ host }-${ scheme }-stopped.png` ),
				} );
			}
			const failStart = await failLifecycle( 'start' );
			await page.getByRole( 'button', { name: 'Start', exact: true } ).click();
			await expect( page.getByRole( 'complementary', { name: 'Site preview' } ) ).toBeHidden();
			await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toHaveCount( 0 );
			await failStart();
			await expect(
				page.getByRole( 'button', { name: 'Start Header one', exact: true } )
			).toBeEnabled();
			const startup = await holdPreview();
			await page.getByRole( 'button', { name: 'Start', exact: true } ).click();
			await startup.wait();
			await expect( page.getByRole( 'complementary', { name: 'Site preview' } ) ).toBeHidden();
			await expect( page.getByRole( 'textbox', { name: 'Address' } ) ).toHaveCount( 0 );
			await expect( publish ).toBeHidden();
			await startup.release();
			if ( app ) await expect( annotate ).toBeVisible();
			await expect( draft ).toHaveValue( 'Preserve this header verification draft' );
			await expect
				.poll( () => lifecyclePublishElement!.evaluate( ( element ) => element.isConnected ) )
				.toBe( true );
			await page.screenshot( {
				animations: 'disabled',
				path: info.outputPath( `${ host }-restarted.png` ),
			} );
		} catch ( error ) {
			console.error( error );
			console.error( logs.slice( -6000 ) );
			await page
				.screenshot( { path: info.outputPath( `${ host }-failure.png` ) } )
				.catch( () => {} );
			throw error;
		} finally {
			for ( const release of releaseRequests ) release();
			await app
				?.evaluate( ( { session } ) => {
					const state = globalThis as typeof globalThis & {
						releaseHeaderData?: () => void;
						releaseHeaderOperation?: () => void;
						headerPreviewCallbacks?: ( ( response: { cancel: boolean } ) => void )[];
					};
					state.releaseHeaderData?.();
					state.releaseHeaderOperation?.();
					session.fromPartition( 'persist:site-preview' ).webRequest.onBeforeRequest( null );
					for ( const callback of state.headerPreviewCallbacks ?? [] ) callback( { cancel: true } );
				} )
				.catch( () => {} );
			await app?.close();
			for ( const site of sites )
				await browserPage.request
					.post( `${ origin }/api/sites/${ site.id }/stop`, { timeout: 10_000 } )
					.catch( () => {} );
			await browserPage.close();
			server.kill( 'SIGTERM' );
			await new Promise< void >( ( resolve ) => {
				if ( server.exitCode !== null ) resolve();
				else server.once( 'exit', () => resolve() );
			} );
			await rm( directory, { recursive: true, force: true } );
		}
	} );
}
