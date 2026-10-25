import { access, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, previewText } from './desktop-app';

test( 'site settings preserve configuration and agent files', async () => {
	const session = await createSession();
	const { app, page, errors, logs } = await launch( session );
	const sitePath = path.join( session.home, 'Studio', 'settings-verification' );
	try {
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeVisible();
		await page
			.getByRole( 'textbox', { name: 'Site name', exact: true } )
			.fill( 'Settings verification' );
		await page.getByRole( 'button', { name: 'Advanced settings' } ).click();
		await expect( page.getByRole( 'textbox', { name: 'Local path' } ) ).toHaveValue( sitePath );
		await page
			.getByRole( 'dialog', { name: 'Add site', exact: true } )
			.getByRole( 'button', { name: 'Create site', exact: true } )
			.click();
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeHidden( {
			timeout: 90_000,
		} );
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );

		const shareDialog = page.getByRole( 'dialog', { name: 'Share', exact: true } );
		await page.getByRole( 'button', { name: 'More preview actions', exact: true } ).click();
		await page.getByRole( 'menuitem', { name: 'Share', exact: true } ).click();
		await expect( shareDialog.getByRole( 'button', { name: 'Create account' } ) ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( shareDialog ).toBeHidden();
		const siteActions = page.getByRole( 'button', {
			name: 'Site actions for Settings verification',
			exact: true,
		} );
		await siteActions.click();
		await page.getByRole( 'menuitem', { name: 'Share', exact: true } ).click();
		await expect( shareDialog ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( shareDialog ).toBeHidden();

		await siteActions.click();
		await page.getByRole( 'menuitem', { name: 'Settings', exact: true } ).click();
		await expect( page.getByRole( 'textbox', { name: 'Site name', exact: true } ) ).toHaveValue(
			'Settings verification'
		);
		const sections = page.getByRole( 'tablist', { name: 'Settings sections' } );
		for ( const tab of [ 'Debug', 'PHP', 'Skills', 'Instructions' ] )
			await sections.getByRole( 'tab', { name: tab, exact: true } ).click();
		await expect( page.getByText( 'AGENTS.md', { exact: true } ) ).toBeVisible();
		await sections.getByRole( 'tab', { name: 'Skills', exact: true } ).click();
		await expect( page.getByText( 'Studio CLI', { exact: true } ) ).toBeVisible();
		await sections.getByRole( 'tab', { name: 'Settings', exact: true } ).click();
		await page.getByRole( 'textbox', { name: 'Site name', exact: true } ).fill( 'Unsaved draft' );
		await page.getByRole( 'tab', { name: 'Studio', exact: true } ).click();
		await expect( page.getByRole( 'combobox', { name: 'Language', exact: true } ) ).toBeVisible();
		await page.getByRole( 'tab', { name: 'Site', exact: true } ).click();
		await expect( page.getByRole( 'textbox', { name: 'Site name', exact: true } ) ).toHaveValue(
			'Unsaved draft'
		);
		await page.getByRole( 'button', { name: 'Close settings' } ).click();
		await page.getByRole( 'button', { name: 'Discard', exact: true } ).click();
		await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );

		await page
			.getByRole( 'button', { name: 'Settings verification', exact: true } )
			.click( { button: 'right' } );
		await page.getByRole( 'menuitem', { name: 'Settings', exact: true } ).click();
		await page
			.getByRole( 'textbox', { name: 'Site name', exact: true } )
			.fill( 'Settings renamed' );
		await page.getByRole( 'tab', { name: 'Debug', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await page.getByRole( 'switch', { name: 'Debug log', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Save', exact: true } ).click();
		await expect( page.getByRole( 'button', { name: 'Save', exact: true } ) ).toHaveCount( 0 );
		await page.getByRole( 'button', { name: 'Close settings' } ).click();
		await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0, { timeout: 90_000 } );
		await expect
			.poll( async () => {
				const config = JSON.parse(
					await readFile( path.join( session.config, 'cli.json' ), 'utf8' )
				);
				const [ site ] = config.sites;
				return { name: site.name, enableDebugLog: site.enableDebugLog };
			} )
			.toEqual( { name: 'Settings renamed', enableDebugLog: true } );
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );

		await page
			.getByRole( 'button', { name: 'Site actions for Settings renamed', exact: true } )
			.click();
		await page.getByRole( 'menuitem', { name: 'Settings', exact: true } ).click();
		await page.getByRole( 'tab', { name: 'Debug', exact: true } ).click();
		await expect( page.getByRole( 'switch', { name: 'Debug log', exact: true } ) ).toBeChecked();
		await page.getByRole( 'tab', { name: 'Instructions', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Actions for AGENTS.md', exact: true } ).click();
		await page.getByRole( 'menuitem', { name: 'Uninstall', exact: true } ).click();
		const agents = page.getByRole( 'switch', { name: 'AGENTS.md', exact: true } );
		await expect( agents ).not.toBeChecked();
		await expect( access( path.join( sitePath, 'AGENTS.md' ) ) ).rejects.toThrow();
		await agents.click();
		await expect( agents ).toBeChecked();
		await expect( access( path.join( sitePath, 'AGENTS.md' ) ) ).resolves.toBeUndefined();
		await page.getByRole( 'button', { name: 'Close settings', exact: true } ).click();
		expect( errors ).toEqual( [] );
	} catch ( error ) {
		console.error( logs().slice( -6000 ) );
		throw error;
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );

test( 'Studio settings list available sections and persist preferences', async () => {
	const session = await createSession();
	const { app, page, errors, logs } = await launch( session );
	try {
		const addSite = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
		await expect( addSite ).toBeVisible();
		await addSite.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
		await expect( addSite ).toBeHidden();
		await page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
		const dialog = page.getByRole( 'dialog', { name: 'Settings' } );
		const sections = dialog.getByRole( 'tablist', { name: 'Settings sections' } );
		await expect( sections.getByRole( 'tab' ) ).toHaveText( [
			'General',
			'Appearance',
			'Sharing',
			'AI Providers',
			'MCP',
			'Skills',
			'Instructions',
			'Keyboard',
		] );
		for ( const label of [ 'Instructions', 'Sharing', 'Keyboard', 'Skills', 'AI Providers' ] ) {
			await sections.getByRole( 'tab', { name: label, exact: true } ).click();
			await expect( dialog.getByRole( 'heading', { name: label, exact: true } ) ).toBeVisible();
		}

		await sections.getByRole( 'tab', { name: 'Appearance', exact: true } ).click();
		await dialog.getByRole( 'combobox', { name: 'Theme' } ).click();
		await page.getByRole( 'option', { name: 'Dark', exact: true } ).click();
		await expect( page.locator( 'html' ) ).toHaveAttribute( 'data-color-scheme', 'dark' );
		await expect
			.poll(
				async () =>
					JSON.parse( await readFile( path.join( session.config, 'app.json' ), 'utf8' ) )
						.colorScheme
			)
			.toBe( 'dark' );

		await sections.getByRole( 'tab', { name: 'Instructions', exact: true } ).click();
		await dialog
			.getByRole( 'textbox', { name: 'WordPress Studio instructions' } )
			.fill( 'Use accessible WordPress patterns.' );
		await dialog.getByRole( 'button', { name: 'Close settings' } ).click();
		await expect( dialog ).toBeHidden();
		await page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
		await sections.getByRole( 'tab', { name: 'Instructions', exact: true } ).click();
		await expect(
			dialog.getByRole( 'textbox', { name: 'WordPress Studio instructions' } )
		).toHaveValue( 'Use accessible WordPress patterns.' );
		expect( errors ).toEqual( [] );
	} catch ( error ) {
		console.error( logs().slice( -8000 ) );
		throw error;
	} finally {
		await app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );
