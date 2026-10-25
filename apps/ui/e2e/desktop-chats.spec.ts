import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, previewText } from './desktop-app';

test( 'auto-start chat preference persists and starts a site on send', async () => {
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
		const dialog = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
		await dialog
			.getByRole( 'textbox', { name: 'Site name', exact: true } )
			.fill( 'Auto-start verification' );
		await dialog.getByRole( 'button', { name: 'Create site', exact: true } ).click();
		await expect( dialog ).toBeHidden( { timeout: 90_000 } );
		const stop = page.getByRole( 'button', { name: 'Stop Auto-start verification', exact: true } );
		const start = page.getByRole( 'button', {
			name: 'Start Auto-start verification',
			exact: true,
		} );
		await expect( stop ).toBeEnabled();
		await stop.click();
		await expect( start ).toBeEnabled();
		const chatToggle = page.getByRole( 'button', { name: 'Show chat for active site' } );
		if ( await chatToggle.isVisible() ) await chatToggle.click();
		const input = page.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await expect( input ).toBeEnabled();

		const chip = page.getByRole( 'button', { name: 'Remove Auto-start' } );
		await expect( chip ).toHaveCount( 0 );
		await input.fill( 'Keep this text /auto' );
		await input.press( 'Enter' );
		await expect( chip ).toBeVisible();
		await expect( input ).toHaveValue( 'Keep this text ' );
		await expect( start ).toBeEnabled();
		await page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
		await expect(
			page.getByRole( 'switch', { name: 'Start site when sending a prompt' } )
		).toBeChecked();
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
		await expect( stop ).toBeEnabled();
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		await chip.click();
		await expect( stop ).toBeEnabled();
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

test( 'annotations preserve drafts, accept images, confirm deletion and send from either composer', async () => {
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
	const { app, page, errors, logs } = await launch( session );
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
		const sentAnnotations = () =>
			app.evaluate(
				() =>
					(
						globalThis as typeof globalThis & {
							annotationInputs: {
								sessionId: string;
								options: {
									images: { id: string }[];
									visualAnnotations: { comment: string; imageIds: string[] }[];
								};
							}[];
						}
					 ).annotationInputs
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
		const note = page.getByRole( 'textbox', { name: 'Leave a note' } );
		const pick = async () => {
			await expect
				.poll( () =>
					inspect( `document.readyState === 'complete' && !!document.querySelector('h1,h2')` )
				)
				.toBe( true );
			await inspect(
				`document.querySelector('h1,h2').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:120,clientY:140}))`
			);
			await expect( note ).toBeVisible();
		};
		const markerNumbers = () =>
			inspect(
				`Array.from(document.getElementById('__studio-inspector-host').shadowRoot.querySelectorAll('button'), marker => marker.textContent)`
			);
		const openFirstMarker = () =>
			inspect(
				"document.getElementById('__studio-inspector-host').shadowRoot.querySelector('button').click()"
			);
		const attachImage = ( name: string ) =>
			page.locator( '[data-annotation-overlay] input[type=file]' ).setInputFiles( {
				name,
				mimeType: 'image/png',
				buffer: Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5z0AAAAASUVORK5CYII=',
					'base64'
				),
			} );
		const toolbar = page.getByRole( 'toolbar', { name: 'Annotations' } );
		const toolbarSend = toolbar.getByRole( 'button', { name: /^Send/ } );
		const saveAnnotation = page.getByRole( 'button', { name: 'Save annotation', exact: true } );
		const removeAttachment = page.getByRole( 'button', { name: 'Remove attachment' } );

		await expect( annotate ).toBeEnabled();
		await toggleAnnotation();
		await expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
		await expect( page.getByRole( 'button', { name: 'Publish…', exact: true } ) ).toBeVisible();
		await pick();
		await inspect(
			`document.querySelector('p').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:80,clientY:200}))`
		);
		await expect.poll( markerNumbers ).toEqual( [ '1' ] );
		await note.fill( '   ' );
		await pick();
		await expect( note ).toHaveValue( '' );
		await expect.poll( markerNumbers ).toEqual( [ '1' ] );
		await expect( toolbarSend ).toHaveAccessibleName( 'Send 0 annotations' );
		await expect( toolbarSend ).toBeDisabled();
		await page.bringToFront();
		await note.click();
		await note.press( 'Escape' );
		await expect( note ).toHaveCount( 0 );
		await expect.poll( markerNumbers ).toEqual( [] );

		await pick();
		await expect.poll( markerNumbers ).toEqual( [ '1' ] );
		await expect( saveAnnotation ).toBeDisabled();
		await note.fill( '   ' );
		await note.press( 'Enter' );
		await expect( saveAnnotation ).toBeDisabled();
		await note.press( 'ControlOrMeta+Enter' );
		await expect( note ).toBeVisible();
		await note.fill( 'Make this heading shorter' );
		await expect( saveAnnotation ).toBeEnabled();
		await expect( toolbarSend ).toHaveAccessibleName( 'Send 1 annotation' );
		await attachImage( 'reference.png' );
		await expect( removeAttachment ).toBeVisible();
		await expect( saveAnnotation ).toBeEnabled();

		await toggleAnnotation();
		await expect( toolbar ).toHaveCount( 0 );
		await toggleAnnotation();
		await openFirstMarker();
		await expect( note ).toHaveValue( 'Make this heading shorter' );
		await expect( removeAttachment ).toBeVisible();
		await note.press( 'Enter' );
		await expect( note ).toHaveCount( 0 );
		await expect( toolbarSend ).toHaveAccessibleName( 'Send 1 annotation' );
		await openFirstMarker();
		await expect( note ).toHaveValue( 'Make this heading shorter' );
		await page.getByRole( 'button', { name: 'Reload preview', exact: true } ).click();
		await expect( note ).toHaveValue( 'Make this heading shorter' );
		await expect( removeAttachment ).toBeVisible();
		await note.press( 'Enter' );

		await toolbar.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
		const confirmation = page.getByRole( 'alertdialog', {
			name: 'Delete annotation?',
			exact: true,
		} );
		await expect( confirmation ).toBeVisible();
		await confirmation.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
		await expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
		await toolbar.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
		await confirmation.getByRole( 'button', { name: 'Delete annotations', exact: true } ).click();
		await toggleAnnotation();
		await expect( annotate ).toHaveAttribute( 'aria-pressed', 'false' );

		await toggleAnnotation();
		await pick();
		await note.fill( 'Keep for batch' );
		await note.press( 'Enter' );
		await pick();
		await note.fill( 'Send this directly' );
		await attachImage( 'direct.png' );
		await expect( saveAnnotation ).toBeEnabled();
		await expect( page.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBeHidden();
		await note.press( 'ControlOrMeta+Enter' );
		await expect(
			toolbar.getByRole( 'button', { name: 'Send 1 annotation', exact: true } )
		).toBeEnabled();
		await expect( annotate ).toHaveAttribute( 'aria-pressed', 'true' );
		await expect.poll( async () => ( await sentAnnotations() ).length ).toBe( 1 );
		const [ sent ] = await sentAnnotations();
		expect( sent.options.visualAnnotations ).toMatchObject( [
			{ comment: 'Send this directly', imageIds: [ sent.options.images[ 0 ].id ] },
		] );
		const composer = page.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
		await expect( composer ).toBeVisible();

		await toggleAnnotation();
		await expect( annotate ).toHaveAttribute( 'aria-pressed', 'false' );
		const queuedAnnotation = page.getByRole( 'listitem', { name: /^1 annotation,/ } );
		await expect( queuedAnnotation ).toBeVisible();
		await expect( page.getByRole( 'button', { name: 'Edit queued message' } ) ).toHaveCount( 0 );
		await expect( removeAttachment ).toBeVisible();
		await queuedAnnotation.click();
		await expect( page.getByText( '1. Keep for batch', { exact: true } ) ).toBeVisible();

		await toggleAnnotation();
		for ( const comment of [
			'Make the heading shorter.',
			'Increase the spacing above the introduction.',
			'Use a warmer background color.',
		] ) {
			await pick();
			await note.fill( comment );
			await note.press( 'Enter' );
		}
		const secondBatch = page.getByRole( 'listitem', { name: /^4 annotations,/ } );
		await expect( secondBatch ).toBeVisible();
		await expect( queuedAnnotation ).toHaveCount( 0 );
		await expect( removeAttachment ).toHaveCount( 1 );
		await secondBatch.click();
		await expect( page.getByText( /1\. Keep for batch/ ) ).toBeVisible();
		await expect( page.getByText( /4\. Use a warmer background color\./ ) ).toBeVisible();
		await composer.fill( 'Apply these changes carefully.' );
		const referenceFile = path.join( session.directory, 'annotation-reference.css' );
		await writeFile( referenceFile, 'h1 { font-weight: 600; }' );
		await page.getByLabel( 'Upload attachments' ).setInputFiles( referenceFile );
		await expect(
			page.getByRole( 'listitem', { name: /^annotation-reference.css,/ } )
		).toBeVisible();
		await expect( page.getByRole( 'button', { name: 'Edit queued message' } ) ).toHaveCount( 0 );
		await app.evaluate(
			( { BrowserWindow }, sessionId ) =>
				BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'ai-agent-event', {
					runId: 'annotation-test-run',
					sessionId,
					event: {
						type: 'run.exited',
						timestamp: new Date().toISOString(),
						status: 'success',
						code: 0,
					},
				} ),
			sent.sessionId
		);
		await expect( page.getByRole( 'button', { name: 'Send message', exact: true } ) ).toBeEnabled();
		await toolbar.getByRole( 'button', { name: 'Send 4 annotations', exact: true } ).click();
		await expect( removeAttachment ).toHaveCount( 0 );
		await expect.poll( async () => ( await sentAnnotations() ).length ).toBe( 2 );
		await page.getByRole( 'button', { name: 'Stop Annotation verification', exact: true } ).click();
		await expect( annotate ).toHaveCount( 0 );
		expect( errors ).toEqual( [] );
	} catch ( error ) {
		console.error( logs().slice( -8000 ) );
		throw error;
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );
