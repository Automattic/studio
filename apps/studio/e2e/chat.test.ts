import path from 'path';
import { test, expect } from '@playwright/test';
import fs from 'fs-extra';
import { E2ESession, launchWithSite } from './e2e-helpers';
import Sidebar from './page-objects/sidebar';

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5z0AAAAASUVORK5CYII=',
	'base64'
);

type SentPrompt = {
	sessionId: string;
	prompt: string;
	options: {
		images?: { id: string }[];
		visualAnnotations?: { comment: string; imageIds: string[] }[];
	};
};

// Sends reach the main process, which records them instead of running the agent.
test.describe( 'Chat', () => {
	test.describe.configure( { mode: 'serial' } );

	const session = new E2ESession();
	const siteName = 'Chat verification';
	const composer = () =>
		session.mainWindow.getByRole( 'combobox', { name: 'Message WordPress Studio' } );

	const recordSends = () =>
		session.electronApp.evaluate( ( { ipcMain } ) => {
			const state = globalThis as typeof globalThis & { sentPrompts: unknown[] };
			state.sentPrompts = [];
			ipcMain.removeHandler( 'continueAiSession' );
			ipcMain.handle( 'continueAiSession', async ( _event, sessionId, prompt, options ) => {
				state.sentPrompts.push( { sessionId, prompt, options } );
				return { runId: `e2e-run-${ state.sentPrompts.length }` };
			} );
		} );
	const sentPrompts = () =>
		session.electronApp.evaluate(
			() =>
				( globalThis as typeof globalThis & { sentPrompts: SentPrompt[] } )
					.sentPrompts as SentPrompt[]
		);

	test.beforeAll( async () => {
		await launchWithSite(
			session,
			{ siteName },
			{
				sharedConfig: { aiProvider: 'anthropic-api-key', anthropicApiKey: 'sk-ant-e2e-test' },
			}
		);
	} );

	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'attaches uploaded files to the draft', async () => {
		const textPath = path.join( session.homePath, 'reference.txt' );
		const imagePath = path.join( session.homePath, 'reference.png' );
		await fs.writeFile( textPath, 'A reference file' );
		await fs.writeFile( imagePath, png );

		await new Sidebar( session.mainWindow ).openSite( siteName );
		await composer().fill( 'Use these references' );
		const fileInput = session.mainWindow.getByLabel( 'Upload attachments' );
		await fileInput.setInputFiles( textPath );
		await fileInput.setInputFiles( imagePath );
		const remove = session.mainWindow.getByRole( 'button', { name: 'Remove attachment' } );
		await expect( remove ).toHaveCount( 2 );
		await remove.first().click();
		await expect( remove ).toHaveCount( 1 );
		await remove.click();
		await expect( remove ).toHaveCount( 0 );
		await expect( composer() ).toHaveValue( 'Use these references' );
		await composer().fill( '' );
	} );

	test( 'starts a stopped site on send when auto-start is on, and keeps the preference', async () => {
		const page = session.mainWindow;
		const sidebar = new Sidebar( page );
		await sidebar.toggleSite( siteName );
		await expect( sidebar.getStatusButton( siteName ) ).toHaveAttribute( 'data-state', 'stopped', {
			timeout: 120_000,
		} );
		const chatToggle = page.getByRole( 'button', { name: 'Show chat for active site' } );
		if ( await chatToggle.isVisible() ) {
			await chatToggle.click();
		}

		const chip = page.getByRole( 'button', { name: 'Remove Auto-start' } );
		await composer().fill( '/auto-start' );
		await composer().press( 'Enter' );
		await expect( chip ).toBeVisible();
		await expect
			.poll( async () => ( await session.getAppConfig() ).autoStartSiteOnChat )
			.toBe( true );

		await recordSends();
		await composer().fill( 'Build a home page' );
		await page.getByRole( 'button', { name: 'Send message' } ).click();
		await expect( composer() ).toHaveValue( '' );
		await expect.poll( async () => ( await sentPrompts() ).length ).toBe( 1 );
		await sidebar.expectRunning( siteName );
		await expect.poll( () => session.previewText() ).toContain( 'Hello world!' );

		await session.restart();
		await expect( composer() ).toBeEnabled();
		await expect(
			session.mainWindow.getByRole( 'button', { name: 'Remove Auto-start' } )
		).toBeVisible();
	} );

	test( 'sends an annotation picked on the preview with its image', async () => {
		const page = session.mainWindow;
		const sidebar = new Sidebar( page );
		await sidebar.openSite( siteName );
		const status = sidebar.getStatusButton( siteName );
		await expect( status ).toHaveAttribute( 'data-state', /^(running|stopped)$/, {
			timeout: 120_000,
		} );
		if ( ( await status.getAttribute( 'data-state' ) ) === 'stopped' ) {
			await sidebar.toggleSite( siteName );
			await sidebar.expectRunning( siteName );
		}
		await expect.poll( () => session.previewText() ).toContain( 'Hello world!' );
		await recordSends();

		const inspect = async ( script: string ) => {
			const guestId = await page
				.locator( 'webview' )
				.evaluate( ( element ) =>
					( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
				);
			return session.electronApp.evaluate(
				async ( { webContents }, { id, code } ) =>
					webContents.fromId( id )!.executeJavaScript( code ),
				{ id: guestId, code: script }
			);
		};
		const annotate = page.getByRole( 'button', { name: 'Annotate', exact: true } );
		if ( await annotate.isVisible() ) {
			await annotate.click();
		} else {
			await page.getByRole( 'button', { name: 'More preview actions' } ).click();
			await page.getByRole( 'menuitemcheckbox', { name: 'Annotate' } ).click();
		}
		await expect( page.getByRole( 'toolbar', { name: 'Annotations' } ) ).toBeVisible();

		const note = page.getByRole( 'textbox', { name: 'Leave a note' } );
		await expect
			.poll( () =>
				inspect( `document.readyState === 'complete' && !!document.querySelector('h1,h2')` )
			)
			.toBe( true );
		// The guest click below bypasses Playwright's stability check.
		await page.locator( 'webview' ).click( { trial: true } );
		const pickedPoint = await inspect(
			`(() => {
				const target = document.querySelector('h1,h2');
				const box = target.getBoundingClientRect();
				const point = { x: Math.round(box.left + Math.min(20, box.width / 2)), y: Math.round(box.top + box.height / 2) };
				target.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:point.x,clientY:point.y}));
				return point;
			})()`
		);
		const marker = `document.getElementById('__studio-inspector-host').shadowRoot.querySelector('button')`;
		await expect.poll( () => inspect( `${ marker }?.dataset.pending` ) ).toBe( 'true' );
		await expect
			.poll( () => inspect( `getComputedStyle(document.querySelector('h1,h2')).cursor` ) )
			.toBe( 'crosshair' );
		const markerPoint = await inspect(
			`(() => { const box = ${ marker }.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`
		);
		expect( markerPoint.x ).toBeCloseTo( pickedPoint.x, 3 );
		expect( markerPoint.y ).toBeCloseTo( pickedPoint.y, 3 );
		await note.fill( 'Make this heading shorter' );
		await page.getByRole( 'button', { name: 'Save annotation', exact: true } ).click();
		expect( await sentPrompts() ).toHaveLength( 0 );
		await expect.poll( () => inspect( `${ marker }?.dataset.pending` ) ).toBe( 'false' );
		await inspect( `${ marker }.click()` );
		await expect( note ).toBeVisible();
		await expect.poll( () => inspect( `${ marker }?.dataset.pending` ) ).toBe( 'false' );
		await page.locator( '[data-annotation-overlay] input[type=file]' ).setInputFiles( {
			name: 'reference.png',
			mimeType: 'image/png',
			buffer: png,
		} );
		await expect(
			page
				.getByRole( 'group', { name: 'Annotation', exact: true } )
				.getByRole( 'button', { name: 'Remove attachment' } )
		).toBeVisible();
		await note.press( 'ControlOrMeta+Enter' );

		await expect.poll( async () => ( await sentPrompts() ).length ).toBe( 1 );
		const [ sent ] = await sentPrompts();
		expect( sent.options.visualAnnotations ).toMatchObject( [
			{ comment: 'Make this heading shorter', imageIds: [ sent.options.images![ 0 ].id ] },
		] );
	} );
} );
