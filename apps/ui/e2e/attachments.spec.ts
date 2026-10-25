import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { createSession, launch, startStudioUi } from './desktop-app';

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5z0AAAAASUVORK5CYII=',
	'base64'
);

for ( const host of [ 'browser', 'desktop' ] as const ) {
	test( `${ host } chat attaches dropped and uploaded files`, async ( { page: browserPage } ) => {
		const session = await createSession();
		const sitePath = path.join( session.home, 'Studio', 'attachments' );
		await mkdir( sitePath, { recursive: true } );
		const textPath = path.join( sitePath, 'reference.txt' );
		const imagePath = path.join( sitePath, 'reference.png' );
		await writeFile( textPath, 'A reference file' );
		await writeFile( imagePath, png );
		await writeFile(
			path.join( session.config, 'shared.json' ),
			JSON.stringify( { version: 1, analyticsOptOut: true } )
		);
		await writeFile(
			path.join( session.config, 'cli.json' ),
			JSON.stringify( {
				version: 1,
				sites: [
					{
						id: 'attachment-site',
						name: 'Attachment verification',
						path: sitePath,
						port: await portFinder.getOpenPort(),
						phpVersion: '8.3',
					},
				],
				snapshots: [],
			} )
		);
		let desktop: Awaited< ReturnType< typeof launch > > | undefined;
		let server: Awaited< ReturnType< typeof startStudioUi > > | undefined;
		let page = browserPage;
		try {
			if ( host === 'desktop' ) {
				desktop = await launch( session );
				page = desktop.page;
				const sites = await page.evaluate( () => window.ipcApi.getSiteDetails() );
				await desktop.app.evaluate( ( { ipcMain }, details ) => {
					ipcMain.removeHandler( 'getSiteDetails' );
					ipcMain.handle( 'getSiteDetails', async () => details );
				}, sites );
			} else {
				server = await startStudioUi( {
					DEV_CONFIG_DIR: session.config,
					STUDIO_PROCESS_MANAGER_HOME: path.join( session.directory, 'daemon' ),
				} );
				await page.goto( server.origin );
			}
			const errors: string[] = [];
			page.on( 'pageerror', ( error ) => errors.push( error.message ) );

			await page.getByRole( 'button', { name: 'Attachment verification', exact: true } ).click();
			const input = page.getByRole( 'combobox', { name: 'Message WordPress Studio' } );
			await input.fill( 'Use these references' );
			const fileInput = page.getByLabel( 'Upload attachments' );
			await fileInput.evaluate( ( element ) =>
				element.addEventListener( 'change', ( event ) => event.stopImmediatePropagation(), {
					capture: true,
					once: true,
				} )
			);
			await fileInput.setInputFiles( textPath );
			const drag = ( type: 'dragenter' | 'drop' ) =>
				fileInput.evaluate( ( element, eventType ) => {
					const dataTransfer = new DataTransfer();
					dataTransfer.items.add( ( element as HTMLInputElement ).files![ 0 ] );
					element
						.closest( '[data-slot="input-group"]' )!
						.dispatchEvent(
							new DragEvent( eventType, { bubbles: true, cancelable: true, dataTransfer } )
						);
				}, type );
			await drag( 'dragenter' );
			const overlay = page.getByText( 'Drop to attach', { exact: true } );
			await expect( overlay ).toBeVisible();
			await drag( 'drop' );
			await expect( overlay ).toHaveCount( 0 );
			const remove = page.getByRole( 'button', { name: 'Remove attachment' } );
			await expect( remove ).toHaveCount( 1 );
			await fileInput.setInputFiles( imagePath );
			await expect( remove ).toHaveCount( 2 );
			await remove.first().click();
			await expect( remove ).toHaveCount( 1 );
			await remove.click();
			await expect( remove ).toHaveCount( 0 );
			await expect( input ).toHaveValue( 'Use these references' );
			expect( errors ).toEqual( [] );
		} catch ( error ) {
			console.error( ( desktop?.logs() ?? server?.logs() ?? '' ).slice( -6000 ) );
			throw error;
		} finally {
			await desktop?.app.close();
			if ( server ) {
				await page.close();
				await server.stop();
			}
			await rm( session.directory, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 100,
			} );
		}
	} );
}
