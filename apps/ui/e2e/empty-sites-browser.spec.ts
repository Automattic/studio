import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { startStudioUi } from './desktop-app';

test( 'offers site creation on empty browser launch', async ( { page } ) => {
	const directory = await mkdtemp( path.join( tmpdir(), 'se-' ) );
	const config = path.join( directory, 'config' );
	await mkdir( config );
	await mkdir( path.join( directory, 'daemon' ) );
	await writeFile(
		path.join( config, 'app.json' ),
		JSON.stringify( {
			version: 1,
			colorScheme: 'light',
			defaultSiteDirectory: path.join( directory, 'sites' ),
		} )
	);
	await writeFile(
		path.join( config, 'shared.json' ),
		JSON.stringify( { version: 1, analyticsOptOut: true } )
	);
	const server = await startStudioUi( {
		DEV_CONFIG_DIR: config,
		STUDIO_PROCESS_MANAGER_HOME: path.join( directory, 'daemon' ),
	} );
	try {
		await page.goto( server.origin );
		const dialog = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
		await expect( dialog ).toBeVisible();
		await expect(
			dialog.getByRole( 'heading', { name: 'Choose a starting point', exact: true } )
		).toBeVisible();
		await expect( dialog.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeFocused();

		await dialog.getByRole( 'tab', { name: 'Blog', exact: true } ).click();
		await expect(
			dialog.getByRole( 'button', { name: 'View Skincare Blog', exact: true } )
		).toBeVisible();
		await expect(
			dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } )
		).toBeHidden();
		await dialog.getByRole( 'tab', { name: 'Create', exact: true } ).click();
		await dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } ).click();
		await expect( dialog.getByRole( 'heading', { name: 'Wedding RSVP', level: 1 } ) ).toBeVisible();
		await expect( dialog.getByRole( 'button', { name: 'Create site' } ) ).toBeFocused();
		await expect
			.poll( () =>
				dialog
					.getByRole( 'img', { name: 'Wedding RSVP screenshot' } )
					.evaluate( ( image ) => ( image as HTMLImageElement ).naturalWidth )
			)
			.toBeGreaterThan( 0 );
		await expect( dialog.getByRole( 'button', { name: 'Preview in browser' } ) ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Blueprints', exact: true } ).click();
		await expect(
			dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } )
		).toBeFocused();

		await dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
		await expect( dialog.getByLabel( 'Site name' ) ).toBeFocused();
		await dialog.getByRole( 'button', { name: 'Back', exact: true } ).click();
		await expect( dialog.getByRole( 'tablist', { name: 'Ways to add a site' } ) ).toBeVisible();
		await dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
		await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect( dialog ).toBeHidden();
		const addSite = page.getByRole( 'button', { name: 'Add site', exact: true } ).last();
		await expect( addSite ).toBeFocused();
		await expect( page.getByText( 'Add a local WordPress site to get started.' ) ).toBeVisible();
		for ( const dismiss of [ 'escape', 'close', 'backdrop' ] ) {
			await addSite.click();
			await expect( dialog ).toBeVisible();
			if ( dismiss === 'escape' ) await page.keyboard.press( 'Escape' );
			else if ( dismiss === 'close' )
				await dialog.getByRole( 'button', { name: 'Close Add site', exact: true } ).click();
			else await page.mouse.click( 4, 4 );
			await expect( dialog ).toBeHidden();
		}

		await page.request.patch( `${ server.origin }/api/user-preferences`, {
			data: { newSiteBehavior: 'blank' },
		} );
		await page.goto( server.origin );
		await expect( dialog.getByLabel( 'Site name' ) ).toBeFocused();
		await dialog.getByLabel( 'Site name' ).fill( 'Isolated first site' );
		await dialog.getByRole( 'button', { name: 'Create site', exact: true } ).click();
		await expect( dialog ).toBeHidden( { timeout: 90_000 } );
		const createdSites = await ( await page.request.get( `${ server.origin }/api/sites` ) ).json();
		expect( createdSites ).toHaveLength( 1 );
		expect( createdSites[ 0 ].path.startsWith( directory ) ).toBe( true );
	} catch ( error ) {
		console.error( server.logs().slice( -6000 ) );
		throw error;
	} finally {
		await page.close();
		await server.stop();
		await rm( directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
	}
} );
