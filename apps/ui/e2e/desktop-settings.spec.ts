import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createSession, launch, previewText } from './desktop-app';

test( 'site settings preserve configuration and agent files in both themes', async ( {
	browserName,
}, info ) => {
	void browserName;
	const session = await createSession();
	const { app, page, errors, logs } = await launch( session );
	try {
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeVisible();
		await page
			.getByRole( 'textbox', { name: 'Site name', exact: true } )
			.fill( 'Settings verification' );
		await page.getByRole( 'button', { name: 'Advanced settings' } ).click();
		await expect( page.getByRole( 'textbox', { name: 'Local path' } ) ).toHaveValue(
			path.join( session.home, 'Studio', 'settings-verification' )
		);
		await page
			.getByRole( 'dialog', { name: 'Add site', exact: true } )
			.getByRole( 'button', { name: 'Create site', exact: true } )
			.click();
		await expect( page.getByRole( 'dialog', { name: 'Add site', exact: true } ) ).toBeHidden( {
			timeout: 90_000,
		} );
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		for ( const theme of [ 'light', 'dark' ] ) {
			await page.evaluate(
				( colorScheme ) =>
					window.ipcApi.setUserPreferences( { colorScheme: colorScheme as 'light' | 'dark' } ),
				theme
			);
			await page.reload();
			await expect( page.locator( 'html' ) ).toHaveAttribute( 'data-color-scheme', theme );
			const shareDialog = page.getByRole( 'dialog', {
				name: 'Share',
				exact: true,
			} );
			await page.getByRole( 'button', { name: 'More preview actions', exact: true } ).click();
			await page.getByRole( 'menuitem', { name: 'Share', exact: true } ).click();
			await expect( shareDialog ).toBeVisible();
			await expect( shareDialog.getByRole( 'button', { name: 'Create account' } ) ).toBeVisible();
			await page.keyboard.press( 'Escape' );
			await expect( shareDialog ).toBeHidden();
			await expect( page.getByRole( 'menu' ) ).toHaveCount( 0 );
			await page
				.getByRole( 'button', { name: 'Site actions for Settings verification', exact: true } )
				.click();
			await expect( page.getByRole( 'menuitem', { name: 'Share', exact: true } ) ).toBeVisible();
			const menuItems = await page.getByRole( 'menuitem' ).allTextContents();
			expect( menuItems[ menuItems.indexOf( 'Share' ) - 1 ] ).toBe( 'Duplicate' );
			await page.getByRole( 'menuitem', { name: 'Share', exact: true } ).click();
			await expect( shareDialog ).toBeVisible();
			await expect( page.getByRole( 'menu' ) ).toBeHidden();
			await page.screenshot( {
				path: info.outputPath( `${ theme }-share-dialog.png` ),
				animations: 'disabled',
			} );
			await page.keyboard.press( 'Escape' );
			await expect( shareDialog ).toBeHidden();
			await page
				.getByRole( 'button', { name: 'Site actions for Settings verification', exact: true } )
				.click();
			await page.getByRole( 'menuitem', { name: 'Settings', exact: true } ).click();
			await expect( page.getByRole( 'textbox', { name: 'Site name', exact: true } ) ).toHaveValue(
				'Settings verification'
			);
			await expect( page.getByRole( 'tablist', { name: 'Settings sections' } ) ).toHaveAttribute(
				'aria-orientation',
				'vertical'
			);
			for ( const tab of [ 'Settings', 'Debug', 'PHP', 'Skills', 'Instructions' ] ) {
				await page
					.getByRole( 'tablist', { name: 'Settings sections' } )
					.getByRole( 'tab', { name: tab, exact: true } )
					.click();
				if ( tab === 'Skills' )
					await expect( page.getByText( 'Studio CLI', { exact: true } ) ).toBeVisible();
				if ( tab === 'Instructions' )
					await expect( page.getByText( 'AGENTS.md', { exact: true } ) ).toBeVisible();
				await page.screenshot( {
					path: info.outputPath( `${ theme }-settings-${ tab.toLowerCase() }.png` ),
					animations: 'disabled',
				} );
			}
			await page.getByRole( 'tab', { name: 'Settings', exact: true } ).click();
			await page.getByRole( 'textbox', { name: 'Site name', exact: true } ).fill( 'Unsaved draft' );
			await page.getByRole( 'tab', { name: 'Studio', exact: true } ).click();
			await expect( page.getByRole( 'combobox', { name: 'Language', exact: true } ) ).toBeVisible();
			const header = page.locator( '[data-slot="panel-header"]:visible' );
			await expect( header.getByRole( 'button', { name: 'Save', exact: true } ) ).toBeVisible();
			await expect( page.getByText( 'Unsaved changes', { exact: true } ) ).toHaveCount( 0 );
			await page.getByRole( 'tab', { name: 'Site', exact: true } ).click();
			await expect( page.getByRole( 'textbox', { name: 'Site name', exact: true } ) ).toHaveValue(
				'Unsaved draft'
			);
			await page.screenshot( {
				path: info.outputPath( `${ theme }-header-actions.png` ),
				animations: 'disabled',
			} );
			await page.getByRole( 'button', { name: 'Close settings' } ).click();
			await expect( page.getByRole( 'dialog' ) ).toHaveCount( 1 );
			await page.getByRole( 'button', { name: 'Discard', exact: true } ).click();
			await expect( page.locator( '[role="dialog"][data-layout="settings"]' ) ).toBeHidden();
		}
		const row = page.getByRole( 'button', { name: 'Settings verification', exact: true } );
		await row.click( { button: 'right' } );
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
		await expect( page.locator( '[role="dialog"][data-layout="settings"]' ) ).toBeHidden( {
			timeout: 90_000,
		} );
		await expect.poll( () => previewText( app, page ) ).toContain( 'Hello world!' );
		await page
			.getByRole( 'button', { name: /^Site actions for Settings (renamed|verification)$/ } )
			.click();
		await page.getByRole( 'menuitem', { name: 'Settings', exact: true } ).click();
		await page.getByRole( 'tab', { name: 'Debug', exact: true } ).click();
		await expect( page.getByRole( 'switch', { name: 'Debug log', exact: true } ) ).toBeChecked();
		await page.getByRole( 'tab', { name: 'Instructions', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Actions for AGENTS.md', exact: true } ).click();
		await page.getByRole( 'menuitem', { name: 'Uninstall', exact: true } ).click();
		const agents = page.getByRole( 'switch', { name: 'AGENTS.md', exact: true } );
		await expect( agents ).not.toBeChecked();
		await agents.click();
		await expect( agents ).toBeChecked();
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

test( 'Studio settings list available sections and persist preferences through IPC', async ( {
	browserName,
}, info ) => {
	expect( browserName ).toBe( 'chromium' );
	const session = await createSession();
	const launched = await launch( session );
	try {
		const { page } = launched;
		const addSite = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
		await expect( addSite ).toBeVisible();
		await addSite.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
		await expect( addSite ).toBeHidden();
		await page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
		const dialog = page.locator( '[role="dialog"][data-layout="settings"]' );
		await expect( dialog ).toHaveAttribute( 'data-layout', 'settings' );
		await expect(
			dialog.getByRole( 'tablist', { name: 'Settings sections' } ).getByRole( 'tab' )
		).toHaveText( [
			'General',
			'Appearance',
			'Sharing',
			'AI Providers',
			'MCP',
			'Skills',
			'Instructions',
			'Keyboard',
		] );
		for ( const theme of [ 'Dark', 'Light' ] ) {
			await dialog.getByRole( 'tab', { name: 'Appearance', exact: true } ).click();
			await dialog.getByRole( 'combobox', { name: 'Theme' } ).click();
			await page.getByRole( 'option', { name: theme, exact: true } ).click();
			await expect
				.poll( () => page.locator( 'html' ).getAttribute( 'data-color-scheme' ) )
				.toBe( theme.toLowerCase() );
			await expect
				.poll(
					async () =>
						JSON.parse( await readFile( path.join( session.config, 'app.json' ), 'utf8' ) )
							.colorScheme
				)
				.toBe( theme.toLowerCase() );
			await page.screenshot( {
				path: info.outputPath( `app-settings-${ theme.toLowerCase() }.png` ),
				animations: 'disabled',
			} );
			for ( const label of [ 'Instructions', 'Sharing', 'Keyboard', 'Skills', 'AI Providers' ] ) {
				await dialog.getByRole( 'tab', { name: label, exact: true } ).click();
				await expect( dialog.getByRole( 'heading', { name: label, exact: true } ) ).toBeVisible();
				await page.screenshot( {
					path: info.outputPath( `settings-${ label.toLowerCase() }-${ theme.toLowerCase() }.png` ),
					animations: 'disabled',
				} );
			}
			await dialog.getByRole( 'tab', { name: 'General', exact: true } ).click();
		}
		await dialog.getByRole( 'tab', { name: 'Instructions', exact: true } ).click();
		await dialog
			.getByRole( 'textbox', { name: 'WordPress Studio instructions' } )
			.fill( 'Use accessible WordPress patterns.' );
		await expect( dialog ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Close settings' } ).click();
		await page.getByRole( 'button', { name: 'Settings', exact: true } ).click();
		await dialog.getByRole( 'tab', { name: 'Instructions', exact: true } ).click();
		await expect(
			dialog.getByRole( 'textbox', { name: 'WordPress Studio instructions' } )
		).toHaveValue( 'Use accessible WordPress patterns.' );
		expect( launched.errors ).toEqual( [] );
	} catch ( error ) {
		console.error( launched.logs().slice( -8000 ) );
		throw error;
	} finally {
		await launched.app.close();
		await rm( session.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );
