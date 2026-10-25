import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, previewText, startStudioUi } from './desktop-app';
import type { ElectronApplication, Page } from 'playwright';

async function command( page: Page, name: string ) {
	await page.keyboard.press( 'ControlOrMeta+k' );
	const palette = page.getByRole( 'dialog', { name: 'Command palette' } );
	await palette.getByRole( 'combobox' ).fill( name );
	await palette.getByRole( 'option' ).filter( { hasText: name } ).first().click();
}

async function headerAction( page: Page, name: string ) {
	const button = page.getByRole( 'button', { name, exact: true } );
	await expect( async () => {
		try {
			if ( await button.isVisible() ) await button.click( { timeout: 2000 } );
			else {
				await page
					.getByRole( 'button', { name: 'More preview actions' } )
					.click( { timeout: 2000 } );
				await page.getByRole( 'menuitem', { name, exact: true } ).click( { timeout: 2000 } );
			}
		} catch ( error ) {
			await page.keyboard.press( 'Escape' );
			throw error;
		}
	} ).toPass();
}

function holdPreviewInDesktop( app: ElectronApplication, siteUrl: string, fail: boolean ) {
	const held = () =>
		app.evaluate(
			() =>
				( globalThis as typeof globalThis & { headerPreviewCallbacks: unknown[] } )
					.headerPreviewCallbacks.length
		);
	return {
		install: () =>
			app.evaluate( ( { session }, origin ) => {
				const state = globalThis as typeof globalThis & {
					headerPreviewCallbacks: ( ( response: { cancel?: boolean } ) => void )[];
				};
				state.headerPreviewCallbacks = [];
				session
					.fromPartition( 'persist:site-preview' )
					.webRequest.onBeforeRequest( { urls: [ '<all_urls>' ] }, ( details, callback ) => {
						if ( details.resourceType === 'mainFrame' && details.url.startsWith( origin ) )
							state.headerPreviewCallbacks.push( callback );
						else callback( {} );
					} );
			}, new URL( siteUrl ).origin ),
		wait: () => expect.poll( held ).toBeGreaterThan( 0 ),
		release: () =>
			app.evaluate( ( { session }, cancel ) => {
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

for ( const host of [ 'browser', 'desktop' ] as const ) {
	test( `preview header actions and site lifecycle in the ${ host } host`, async ( {
		page: browserPage,
	} ) => {
		test.setTimeout( 300_000 );
		const session = await createSession();
		await writeFile(
			path.join( session.config, 'shared.json' ),
			JSON.stringify( {
				version: 1,
				analyticsOptOut: true,
				aiProvider: 'anthropic-api-key',
				anthropicApiKey: 'sk-ant-isolated-header-test',
			} )
		);
		const server = await startStudioUi( {
			DEV_CONFIG_DIR: session.config,
			STUDIO_PROCESS_MANAGER_HOME: path.join( session.directory, 'daemon' ),
		} );
		let desktop: Awaited< ReturnType< typeof launch > > | undefined;
		let page = browserPage;
		const sites: { id: string; url: string }[] = [];
		const releaseRequests: ( () => void )[] = [];
		try {
			if ( host === 'desktop' ) {
				desktop = await launch( session );
				page = desktop.page;
			} else await page.goto( server.origin );
			const app = desktop?.app;
			const holdPreview = async ( fail = false, site = sites[ 0 ] ) => {
				if ( app ) {
					const hold = holdPreviewInDesktop( app, site.url, fail );
					await hold.install();
					return hold;
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
					release: async () => release(),
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
								app.evaluate( () =>
									Boolean(
										( globalThis as typeof globalThis & { releaseHeaderOperation?: () => void } )
											.releaseHeaderOperation
									)
								)
							)
							.toBe( true );
						await app.evaluate( () =>
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
				return async () => finish();
			};

			const add = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
			const publish = page.locator( '[data-site-header-publish] button' );
			const address = page.getByRole( 'textbox', { name: 'Address' } );
			await expect( add ).toBeVisible();
			await expect( publish ).toHaveCount( 0 );
			await expect( address ).toHaveCount( 0 );
			await add.getByRole( 'button', { name: 'Close Add site' } ).click();
			for ( const name of [ 'Header one', 'Header two' ] ) {
				const response = await browserPage.request.post( `${ server.origin }/api/sites`, {
					data: { name, path: path.join( session.directory, name ), runtime: 'native-php' },
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
				const chat = await browserPage.request.post( `${ server.origin }/api/sessions`, {
					data: { siteId: sites[ 0 ].id },
				} );
				await browserPage.request.patch(
					`${ server.origin }/api/sessions/${ ( ( await chat.json() ) as { id: string } ).id }`,
					{ data: { title: 'Header chat' } }
				);
			}
			await page.evaluate( () =>
				location.hash ? ( location.hash = '#/' ) : history.replaceState( null, '', '/' )
			);
			await page.reload( { waitUntil: 'domcontentloaded' } );

			await page.getByRole( 'button', { name: 'Header one', exact: true } ).click();
			const annotate = page.getByRole( 'button', { name: 'Annotate', exact: true } );
			if ( app ) await expect( annotate ).toBeVisible();
			if ( desktop )
				await expect.poll( () => previewText( desktop!.app, page ) ).toContain( 'Hello world!' );
			else
				await expect(
					page
						.frameLocator( 'iframe' )
						.getByRole( 'link', { name: 'Hello world!', exact: true } )
						.first()
				).toBeVisible();
			await page.getByRole( 'button', { name: 'Header chat', exact: true } ).first().click();
			const draft = page.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
			await draft.fill( 'Preserve this header verification draft' );
			const previewElement = await page
				.getByRole( 'complementary', { name: 'Site preview' } )
				.locator( app ? 'webview' : 'iframe' )
				.elementHandle();

			await headerAction( page, 'Share' );
			const sharing = page.getByRole( 'dialog', { name: 'Share', exact: true } );
			await expect( sharing ).toBeVisible();
			await page.keyboard.press( 'Escape' );
			await expect( sharing ).toBeHidden();
			await expect( draft ).toHaveValue( 'Preserve this header verification draft' );
			expect( await previewElement!.evaluate( ( element ) => element.isConnected ) ).toBe( true );

			await command( page, 'Hide preview' );
			await expect( address ).toHaveCount( 0 );
			await expect( publish ).toBeHidden();
			if ( app ) await expect( annotate ).toBeHidden();
			await expect( page.getByRole( 'button', { name: 'Stop', exact: true } ) ).toBeVisible();
			await command( page, 'Show preview' );
			await expect( address ).toBeVisible();
			await command( page, 'Hide chat' );
			await expect( draft ).toBeHidden();
			await command( page, 'Show chat' );
			await expect( draft ).toHaveValue( 'Preserve this header verification draft' );

			await publish.click();
			const publishDialog = page.getByRole( 'dialog' );
			await expect( publishDialog ).toBeVisible();
			await page.keyboard.press( 'Escape' );
			await expect( publishDialog ).toBeHidden();

			for ( const failed of [ false, true ] ) {
				const gate = await holdPreview( failed );
				await headerAction( page, 'Reload preview' );
				await gate.wait();
				if ( app ) await expect( annotate ).toBeDisabled();
				await expect( address ).toBeVisible();
				await gate.release();
				if ( failed ) {
					if ( app ) await expect( annotate ).toBeDisabled();
					await headerAction( page, 'Reload preview' );
				}
				if ( app ) await expect( annotate ).toBeEnabled();
				await expect( draft ).toHaveValue( 'Preserve this header verification draft' );
			}
			const switchPreview = await holdPreview( false, sites[ 1 ] );
			await page.getByRole( 'button', { name: 'Header two', exact: true } ).click();
			await switchPreview.wait();
			if ( app ) await expect( annotate ).toBeDisabled();
			await expect( address ).toHaveValue( sites[ 1 ].url.replace( /\/$/, '' ) );
			await switchPreview.release();
			await page.getByRole( 'button', { name: 'Header one', exact: true } ).click();
			await expect( draft ).toHaveValue( 'Preserve this header verification draft' );

			const lifecyclePublishElement = await publish.elementHandle();
			const failStop = await failLifecycle( 'stop' );
			await page.getByRole( 'button', { name: 'Stop', exact: true } ).click();
			await expect( page.getByRole( 'complementary', { name: 'Site preview' } ) ).toBeHidden();
			await expect( publish ).toBeHidden();
			await failStop();
			await expect(
				page.getByRole( 'button', { name: 'Stop Header one', exact: true } )
			).toBeEnabled();
			await expect( address ).toBeVisible();
			await page.getByRole( 'button', { name: 'Stop', exact: true } ).click();
			await expect(
				page.getByRole( 'button', { name: 'Start Header one', exact: true } )
			).toBeEnabled();
			if ( app ) await expect( annotate ).toBeHidden();
			await expect( address ).toHaveCount( 0 );
			await expect( publish ).toBeHidden();

			const failStart = await failLifecycle( 'start' );
			await page.getByRole( 'button', { name: 'Start', exact: true } ).click();
			await expect( page.getByRole( 'complementary', { name: 'Site preview' } ) ).toBeHidden();
			await failStart();
			await expect(
				page.getByRole( 'button', { name: 'Start Header one', exact: true } )
			).toBeEnabled();
			const startup = await holdPreview();
			await page.getByRole( 'button', { name: 'Start', exact: true } ).click();
			await startup.wait();
			await expect( page.getByRole( 'complementary', { name: 'Site preview' } ) ).toBeHidden();
			await expect( address ).toHaveCount( 0 );
			await startup.release();
			await expect( address ).toBeVisible();
			if ( app ) await expect( annotate ).toBeVisible();
			await expect( draft ).toHaveValue( 'Preserve this header verification draft' );
			expect( await lifecyclePublishElement!.evaluate( ( element ) => element.isConnected ) ).toBe(
				true
			);
		} catch ( error ) {
			console.error( ( desktop?.logs() ?? '' ).slice( -4000 ) );
			console.error( server.logs().slice( -4000 ) );
			throw error;
		} finally {
			for ( const release of releaseRequests ) release();
			await desktop?.app
				.evaluate( ( { session: electronSession } ) => {
					const state = globalThis as typeof globalThis & {
						releaseHeaderOperation?: () => void;
						headerPreviewCallbacks?: ( ( response: { cancel: boolean } ) => void )[];
					};
					state.releaseHeaderOperation?.();
					electronSession
						.fromPartition( 'persist:site-preview' )
						.webRequest.onBeforeRequest( null );
					for ( const callback of state.headerPreviewCallbacks ?? [] ) callback( { cancel: true } );
				} )
				.catch( () => {} );
			await desktop?.app.close();
			await browserPage.close();
			await server.stop();
			await rm( session.directory, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 100,
			} );
		}
	} );
}
