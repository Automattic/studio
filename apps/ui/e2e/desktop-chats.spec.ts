import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { createSession, launch, previewText } from './desktop-app';

test( 'auto-start chat preference persists and starts a site on send in both themes', async ( {
	browserName,
} ) => {
	expect( browserName ).toBe( 'chromium' );
	const session = await createSession();
	if ( process.env.STUDIO_E2E_PHP_CACHE ) {
		await cp( process.env.STUDIO_E2E_PHP_CACHE, path.join( session.config, 'php-bin' ), {
			recursive: true,
		} );
	}
	await writeFile(
		path.join( session.config, 'shared.json' ),
		JSON.stringify( {
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-isolated-composer-test',
			version: 1,
			analyticsOptOut: true,
		} )
	);
	let launched = await launch( session );
	try {
		const { page, app } = launched;
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeVisible();
		await page
			.getByRole( 'textbox', { name: 'Site name', exact: true } )
			.fill( 'Auto-start verification' );
		await page
			.getByRole( 'dialog', { name: 'Add site', exact: true } )
			.getByRole( 'button', { name: 'Create site', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Stop Auto-start verification', exact: true } )
		).toBeEnabled();
		await page.getByRole( 'button', { name: 'Stop Auto-start verification', exact: true } ).click();
		await expect(
			page.getByRole( 'button', { name: 'Start Auto-start verification', exact: true } )
		).toBeEnabled();
		const chatToggle = page.getByRole( 'button', { name: 'Show chat for active site' } );
		if ( await chatToggle.isVisible() ) await chatToggle.click();
		const input = page.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await expect( input ).toBeEnabled();

		const chip = page.getByRole( 'button', {
			name: 'Remove Auto-start',
		} );
		await expect( chip ).toHaveCount( 0 );
		for ( const theme of [ 'light', 'dark' ] as const ) {
			await page.evaluate(
				( value ) => window.ipcApi.setUserPreferences( { colorScheme: value } ),
				theme
			);
			await page.reload();
			await input.fill( 'Keep this text /auto' );
			await input.press( 'Enter' );
			await expect( chip ).toBeVisible();
			await expect( input ).toHaveValue( 'Keep this text ' );
			await expect(
				page.getByRole( 'button', { name: 'Start Auto-start verification', exact: true } )
			).toBeEnabled();
			await chip.hover();
			await expect( page.locator( '[data-slot=tooltip-content]' ) ).toHaveText(
				'Remove Auto-start'
			);
			await expect( page.locator( 'html' ) ).toHaveAttribute( 'data-color-scheme', theme );
			await page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
			const toggle = page.getByRole( 'switch', { name: 'Start site when sending a prompt' } );
			await expect( toggle ).toBeChecked();

			await page.getByRole( 'button', { name: 'Close settings', exact: true } ).click();
			await chip.click();
			await expect( chip ).toHaveCount( 0 );
			await expect
				.poll(
					async () =>
						JSON.parse( await readFile( path.join( session.config, 'app.json' ), 'utf8' ) )
							.autoStartSiteOnChat
				)
				.toBe( false );
		}
		await input.fill( '/auto-start' );
		await input.press( 'Tab' );
		await expect( chip ).toBeVisible();
		await app.evaluate( ( { ipcMain } ) => {
			ipcMain.removeHandler( 'continueAiSession' );
			ipcMain.handle( 'continueAiSession', async () => ( {
				runId: 'isolated-provider-dispatch',
			} ) );
		} );
		await input.fill( 'Build a home page' );
		await page.getByRole( 'button', { name: 'Send message' } ).click();
		await expect( input ).toHaveValue( '' );
		await expect(
			page.getByRole( 'button', { name: 'Stop Auto-start verification', exact: true } )
		).toBeEnabled();
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		await chip.click();
		await expect(
			page.getByRole( 'button', { name: 'Stop Auto-start verification', exact: true } )
		).toBeEnabled();
		await input.fill( '/auto-start' );
		await input.press( 'Enter' );
		await expect( chip ).toBeVisible();
		await launched.app.close();
		launched = await launch( session );
		await expect(
			launched.page.getByRole( 'combobox', { name: 'Message WordPress Studio' } )
		).toBeEnabled();
		await expect(
			launched.page.getByRole( 'button', { name: 'Remove Auto-start' } )
		).toBeVisible();
		expect( launched.errors ).toEqual( [] );
	} catch ( error ) {
		console.error( launched.logs().slice( -8000 ) );
		throw error;
	} finally {
		await launched.app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );

test( 'annotations preserve drafts, accept images, confirm deletion and send from either composer in both themes', async ( {
	browserName,
}, info ) => {
	void browserName;
	const session = await createSession();
	await writeFile(
		path.join( session.config, 'shared.json' ),
		JSON.stringify( {
			version: 1,
			analyticsOptOut: true,
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'sk-ant-isolated-annotations-test',
		} )
	);
	const { app, page, errors } = await launch( session );
	try {
		const dialog = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
		await dialog
			.getByRole( 'textbox', { name: 'Site name', exact: true } )
			.fill( 'Annotation verification' );
		await dialog.getByRole( 'button', { name: 'Create site', exact: true } ).click();
		await expect( dialog ).toBeHidden( { timeout: 90_000 } );
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		await app.evaluate( ( { ipcMain } ) => {
			const state = globalThis as typeof globalThis & { annotationInputs?: unknown[] };
			state.annotationInputs = [];
			ipcMain.removeHandler( 'continueAiSession' );
			ipcMain.handle( 'continueAiSession', async ( _event, sessionId, prompt, options ) => {
				state.annotationInputs!.push( { sessionId, prompt, options } );
				return { runId: 'annotation-test-run' };
			} );
		} );
		await app.evaluate( ( { BrowserWindow } ) =>
			BrowserWindow.getAllWindows()[ 0 ].setSize( 1100, 820 )
		);
		if ( await page.getByRole( 'button', { name: 'Hide chat', exact: true } ).isVisible() ) {
			await page.getByRole( 'button', { name: 'Hide chat', exact: true } ).click();
		}
		const annotate = page.locator( '[data-site-header-annotate] button' );
		const toggleAnnotation = async () => {
			if ( await annotate.isVisible() ) await annotate.click();
			else {
				await page.getByRole( 'button', { name: 'More preview actions' } ).click();
				await page.getByRole( 'menuitemcheckbox', { name: 'Annotate' } ).click();
			}
		};
		const inspect = async ( script: string ) => {
			const guestId = await page
				.locator( 'webview' )
				.evaluate( ( element ) =>
					( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
				);
			return app.evaluate(
				async ( { webContents }, { id, code } ) =>
					webContents.fromId( id )!.executeJavaScript( code ),
				{ id: guestId, code: script }
			);
		};
		const pick = async () => {
			await expect
				.poll( () =>
					inspect( `document.readyState === 'complete' && !!document.querySelector('h1,h2')` )
				)
				.toBe( true );
			await inspect(
				`document.querySelector('h1,h2').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:120,clientY:140}))`
			);
			await expect( page.getByRole( 'textbox', { name: 'Leave a note' } ) ).toBeVisible();
		};
		const markerNumbers = () =>
			inspect(
				`Array.from(document.getElementById('__studio-inspector-host').shadowRoot.querySelectorAll('button'), marker => marker.textContent)`
			);
		for ( const scheme of [ 'light', 'dark' ] as const ) {
			if ( scheme === 'dark' ) {
				await page.keyboard.press( 'ControlOrMeta+k' );
				const palette = page.getByRole( 'dialog', { name: 'Command palette' } );
				await palette.getByRole( 'combobox' ).fill( 'Use dark mode' );
				await palette.getByRole( 'option', { name: 'Use dark mode', exact: true } ).click();
				await expect( page.locator( 'html' ) ).toHaveAttribute( 'data-color-scheme', 'dark' );
			}
			await expect( annotate ).toBeEnabled();
			await expect( page.locator( '[data-site-header-actions]' ) ).toHaveAttribute(
				'data-site-header-actions',
				'inline'
			);
			const publishBounds = await page
				.getByRole( 'button', { name: 'Publish…', exact: true } )
				.boundingBox();
			const annotateBounds = await annotate.boundingBox();
			await toggleAnnotation();
			await expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
			const toolbarSend = page
				.getByRole( 'toolbar', { name: 'Annotations' } )
				.getByRole( 'button', { name: /^Send/ } );
			expect(
				await page.getByRole( 'button', { name: 'Publish…', exact: true } ).boundingBox()
			).toEqual( publishBounds );
			expect( await annotate.boundingBox() ).toEqual( annotateBounds );
			await expect( page.getByRole( 'button', { name: 'Share', exact: true } ) ).toBeVisible();
			await expect( page.getByRole( 'button', { name: 'Publish…', exact: true } ) ).toBeVisible();
			await expect(
				page.locator( '[data-site-header-publish]' ).getByRole( 'button', { name: /^Send/ } )
			).toHaveCount( 0 );
			await pick();
			const note = page.getByRole( 'textbox', { name: 'Leave a note' } );
			const hover = await inspect( `
				new Promise(resolve => {
					const target = document.querySelector('p');
					target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
					requestAnimationFrame(() => {
						const highlight = document.getElementById('__studio-inspector-host').shadowRoot.querySelector('.highlight');
						resolve({ actual: highlight.getBoundingClientRect().top, expected: target.getBoundingClientRect().top });
					});
				})
			` );
			expect( hover.actual ).toBe( hover.expected );
			await expect( note ).toBeVisible();
			await page.screenshot( { path: info.outputPath( `annotations-${ scheme }-hover.png` ) } );
			await inspect(
				`document.querySelector('p').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:80,clientY:200}))`
			);
			await expect.poll( markerNumbers ).toEqual( [ '1' ] );
			await note.fill( '   ' );
			await pick();
			await expect( note ).toHaveValue( '' );
			await expect.poll( markerNumbers ).toEqual( [ '1' ] );
			await expect(
				page
					.getByRole( 'toolbar', { name: 'Annotations' } )
					.getByRole( 'button', { name: 'Send 0 annotations', exact: true } )
			).toBeDisabled();
			await page.bringToFront();
			await note.click();
			await note.press( 'Escape' );
			await expect( note ).toHaveCount( 0 );
			await expect.poll( markerNumbers ).toEqual( [] );
			await pick();
			await expect.poll( markerNumbers ).toEqual( [ '1' ] );
			const saveAnnotation = page.getByRole( 'button', { name: 'Save annotation', exact: true } );
			await expect( saveAnnotation ).toBeDisabled();
			await page.screenshot( { path: info.outputPath( `annotations-${ scheme }-empty.png` ) } );
			await note.fill( '   ' );
			await note.press( 'Enter' );
			await expect( saveAnnotation ).toBeDisabled();
			await expect( note ).not.toHaveAttribute( 'aria-invalid' );
			await note.press( 'ControlOrMeta+Enter' );
			await expect( note ).toBeVisible();
			await expect( note ).not.toHaveAttribute( 'aria-invalid' );
			await note.fill( 'Make this heading shorter' );
			await expect( saveAnnotation ).toBeEnabled();
			await expect( toolbarSend ).toHaveAccessibleName( 'Send 1 annotation' );
			await expect( toolbarSend.locator( '[data-slot=badge]' ) ).toHaveCount( 0 );
			expect(
				await page.getByRole( 'button', { name: 'Publish…', exact: true } ).boundingBox()
			).toEqual( publishBounds );
			expect( await annotate.boundingBox() ).toEqual( annotateBounds );
			await expect( note ).not.toHaveAttribute( 'aria-invalid' );
			await page.locator( '[data-annotation-overlay] input[type=file]' ).setInputFiles( {
				name: 'reference.png',
				mimeType: 'image/png',
				buffer: Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5z0AAAAASUVORK5CYII=',
					'base64'
				),
			} );
			await expect( page.getByRole( 'button', { name: 'Remove attachment' } ) ).toBeVisible();
			await expect(
				page.getByRole( 'button', { name: 'Save annotation', exact: true } )
			).toBeEnabled();
			await page.screenshot( { path: info.outputPath( `annotations-${ scheme }.png` ) } );
			await page.keyboard.press( 'ControlOrMeta+k' );
			await page.getByRole( 'combobox' ).fill( 'Show chat' );
			await page.getByRole( 'option' ).filter( { hasText: 'Show chat' } ).click();
			const windowSize = await app.evaluate( ( { BrowserWindow } ) => {
				const window = BrowserWindow.getAllWindows()[ 0 ];
				const size = window.getSize();
				window.setSize( 1000, size[ 1 ] );
				return size;
			} );
			await expect( annotate ).toBeVisible();
			await expect( annotate ).toHaveText( '' );
			await expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
			await expect( page.locator( '[data-site-header-actions]' ) ).toHaveAttribute(
				'data-site-header-actions',
				'navigation-overflow'
			);
			await page.screenshot( { path: info.outputPath( `annotations-${ scheme }-compact.png` ) } );
			await page.keyboard.press( 'ControlOrMeta+k' );
			await page.getByRole( 'combobox' ).fill( 'Hide chat' );
			await page.getByRole( 'option' ).filter( { hasText: 'Hide chat' } ).click();
			await app.evaluate(
				( { BrowserWindow }, size ) =>
					BrowserWindow.getAllWindows()[ 0 ].setSize( size[ 0 ], size[ 1 ] ),
				windowSize
			);
			await expect( annotate ).toHaveText( 'Annotate' );
			await toggleAnnotation();
			await expect( page.getByRole( 'toolbar', { name: 'Annotations' } ) ).toHaveCount( 0 );
			await toggleAnnotation();
			await inspect(
				"document.getElementById('__studio-inspector-host').shadowRoot.querySelector('button').click()"
			);
			await expect( note ).toHaveValue( 'Make this heading shorter' );
			await expect( page.getByRole( 'button', { name: 'Remove attachment' } ) ).toBeVisible();
			await note.press( 'Enter' );
			await expect( note ).toHaveCount( 0 );
			await expect( toolbarSend.locator( '[data-slot=badge]' ) ).toHaveText( '1' );
			const guestId = await page
				.locator( 'webview' )
				.evaluate( ( element ) =>
					( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
				);
			await app.evaluate(
				async ( { webContents }, id ) =>
					webContents
						.fromId( id )!
						.executeJavaScript(
							"document.getElementById('__studio-inspector-host').shadowRoot.querySelector('button').click()"
						),
				guestId
			);
			await expect( note ).toHaveValue( 'Make this heading shorter' );
			await page.getByRole( 'button', { name: 'Reload preview', exact: true } ).click();
			await expect( note ).toHaveValue( 'Make this heading shorter' );
			await expect( page.getByRole( 'button', { name: 'Remove attachment' } ) ).toBeVisible();
			await expect( note ).toHaveValue( 'Make this heading shorter' );
			await note.press( 'Enter' );
			await page
				.getByRole( 'toolbar', { name: 'Annotations' } )
				.getByRole( 'button', { name: 'Cancel', exact: true } )
				.click();
			const confirmation = page.getByRole( 'alertdialog', {
				name: 'Delete annotation?',
				exact: true,
			} );
			await expect( confirmation ).toBeVisible();
			await confirmation.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
			await expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
			await page
				.getByRole( 'toolbar', { name: 'Annotations' } )
				.getByRole( 'button', { name: 'Cancel', exact: true } )
				.click();
			await confirmation.getByRole( 'button', { name: 'Delete annotations', exact: true } ).click();
			await toggleAnnotation();
			await expect( annotate ).toHaveAttribute( 'aria-pressed', 'false' );
		}
		await toggleAnnotation();
		await pick();
		await page.getByRole( 'textbox', { name: 'Leave a note' } ).fill( 'Keep for batch' );
		await page.getByRole( 'textbox', { name: 'Leave a note' } ).press( 'Enter' );
		await pick();
		await page.getByRole( 'textbox', { name: 'Leave a note' } ).fill( 'Send this directly' );
		await page.locator( '[data-annotation-overlay] input[type=file]' ).setInputFiles( {
			name: 'direct.png',
			mimeType: 'image/png',
			buffer: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5z0AAAAASUVORK5CYII=',
				'base64'
			),
		} );
		await expect(
			page.getByRole( 'button', { name: 'Save annotation', exact: true } )
		).toBeEnabled();
		await expect( page.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBeHidden();
		await page.getByRole( 'textbox', { name: 'Leave a note' } ).press( 'ControlOrMeta+Enter' );
		await expect(
			page
				.getByRole( 'toolbar', { name: 'Annotations' } )
				.getByRole( 'button', { name: 'Send 1 annotation', exact: true } )
		).toBeEnabled();
		await expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
		await expect
			.poll( () =>
				app.evaluate(
					() =>
						( globalThis as typeof globalThis & { annotationInputs: unknown[] } ).annotationInputs
							.length
				)
			)
			.toBe( 1 );
		const sent = await app.evaluate(
			() =>
				(
					globalThis as typeof globalThis & {
						annotationInputs: {
							options: {
								images: { id: string }[];
								visualAnnotations: { comment: string; imageIds: string[] }[];
							};
						}[];
					}
				 ).annotationInputs[ 0 ]
		);
		expect( sent.options.visualAnnotations ).toMatchObject( [
			{ comment: 'Send this directly', imageIds: [ sent.options.images[ 0 ].id ] },
		] );
		await expect(
			page.getByRole( 'combobox', { name: 'Message WordPress Studio' } )
		).toBeVisible();
		await toggleAnnotation();
		await expect( annotate ).toHaveAttribute( 'aria-pressed', 'false' );
		const queuedAnnotation = page.getByRole( 'listitem', { name: /^1 annotation,/ } );
		await expect( queuedAnnotation ).toBeVisible();
		await expect( page.getByRole( 'button', { name: 'Edit queued message' } ) ).toHaveCount( 0 );
		await expect( page.getByRole( 'button', { name: 'Remove attachment' } ) ).toBeVisible();
		await expect
			.poll(
				async () =>
					( await page
						.getByRole( 'complementary', { name: 'Site preview' } )
						.locator( '[data-site-header]' )
						.boundingBox() )!.width
			)
			.toBeLessThanOrEqual( 500 );
		await page.screenshot( { path: info.outputPath( 'annotations-main-chat.png' ) } );
		await queuedAnnotation.click();
		await expect( page.getByText( '1. Keep for batch', { exact: true } ) ).toBeVisible();
		await page.screenshot( { path: info.outputPath( 'annotations-attachment-dark.png' ) } );
		await page.keyboard.press( 'ControlOrMeta+k' );
		await page.getByRole( 'combobox' ).fill( 'Use light mode' );
		await page.getByRole( 'option', { name: 'Use light mode', exact: true } ).click();
		await expect( page.locator( 'html' ) ).not.toHaveAttribute( 'data-color-scheme', 'dark' );
		await queuedAnnotation.click();
		await expect( page.getByText( '1. Keep for batch', { exact: true } ) ).toBeVisible();
		await page.screenshot( { path: info.outputPath( 'annotations-attachment-light.png' ) } );
		await toggleAnnotation();
		for ( const comment of [
			'Make the heading shorter.',
			'Increase the spacing above the introduction.',
			'Use a warmer background color.',
		] ) {
			await pick();
			await page.getByRole( 'textbox', { name: 'Leave a note' } ).fill( comment );
			await page.getByRole( 'textbox', { name: 'Leave a note' } ).press( 'Enter' );
		}

		const secondBatch = page.getByRole( 'listitem', { name: /^4 annotations,/ } );
		await expect( secondBatch ).toBeVisible();
		await expect( queuedAnnotation ).toHaveCount( 0 );
		await expect( page.getByRole( 'button', { name: 'Remove attachment' } ) ).toHaveCount( 1 );
		await page
			.getByRole( 'combobox', { name: 'Message WordPress Studio' } )
			.fill( 'Please apply these updates and keep the existing typography.' );
		await page.screenshot( { path: info.outputPath( 'annotations-multiple-staged.png' ) } );
		await secondBatch.click();
		await expect( page.getByText( /1\. Keep for batch/ ) ).toBeVisible();
		await expect( page.getByText( /4\. Use a warmer background color\./ ) ).toBeVisible();
		await page.getByText( /1\. Keep for batch/ ).hover();
		await page.screenshot( { path: info.outputPath( 'annotations-multiple-preview.png' ) } );
		await page.keyboard.press( 'ControlOrMeta+k' );
		await page.getByRole( 'combobox' ).fill( 'Use dark mode' );
		await page.getByRole( 'option', { name: 'Use dark mode', exact: true } ).click();
		await expect( secondBatch ).toBeVisible();
		await page.screenshot( { path: info.outputPath( 'annotations-multiple-staged-dark.png' ) } );
		await page
			.getByRole( 'combobox', { name: 'Message WordPress Studio' } )
			.fill( 'Apply these changes carefully.' );
		const referenceFile = path.join( session.directory, 'annotation-reference.css' );
		await writeFile( referenceFile, 'h1 { font-weight: 600; }' );
		await page.getByLabel( 'Upload attachments' ).setInputFiles( referenceFile );
		await expect(
			page.getByRole( 'listitem', { name: /^annotation-reference.css,/ } )
		).toBeVisible();
		await expect( page.getByRole( 'button', { name: 'Edit queued message' } ) ).toHaveCount( 0 );
		await app.evaluate( ( { BrowserWindow } ) => {
			const inputs = (
				globalThis as typeof globalThis & { annotationInputs: { sessionId: string }[] }
			 ).annotationInputs;
			BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'ai-agent-event', {
				runId: 'annotation-test-run',
				sessionId: inputs[ 0 ].sessionId,
				event: {
					type: 'run.exited',
					timestamp: new Date().toISOString(),
					status: 'success',
					code: 0,
				},
			} );
		} );
		await expect( page.getByRole( 'button', { name: 'Send message', exact: true } ) ).toBeEnabled();
		await page
			.getByRole( 'toolbar', { name: 'Annotations' } )
			.getByRole( 'button', { name: 'Send 4 annotations', exact: true } )
			.click();
		await expect( page.getByRole( 'button', { name: 'Remove attachment' } ) ).toHaveCount( 0 );
		await expect
			.poll( () =>
				app.evaluate(
					() =>
						( globalThis as typeof globalThis & { annotationInputs: unknown[] } ).annotationInputs
							.length
				)
			)
			.toBe( 2 );
		await page.getByRole( 'button', { name: 'Stop Annotation verification', exact: true } ).click();
		await expect( annotate ).toHaveCount( 0 );
		expect( errors ).toEqual( [] );
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );
