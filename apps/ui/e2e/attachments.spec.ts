import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { packagedApp } from './packaged-app';
import type { ElectronApplication } from 'playwright';

for ( const host of [ 'browser', 'desktop' ] as const ) {
	test( `${ host } chat attaches files across its pane in both themes`, async ( {
		page: browserPage,
	}, info ) => {
		const directory = await mkdtemp( '/tmp/sa-' );
		const config = path.join( directory, 'config' );
		const home = path.join( directory, 'home' );
		const sitePath = path.join( home, 'Studio', 'attachments' );
		await mkdir( config );
		await mkdir( sitePath, { recursive: true } );
		await mkdir( path.join( directory, 'daemon' ) );
		const textPath = path.join(
			sitePath,
			'a-very-long-reference-filename-that-must-fit-in-the-composer.txt'
		);
		await writeFile( textPath, 'A reference file' );
		await writeFile(
			path.join( config, 'shared.json' ),
			JSON.stringify( { version: 1, analyticsOptOut: true } )
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
				quitSitesBehavior: 'stop',
				cliUserUninstalled: true,
				lastNightlyUpdateCheck: Date.now(),
				nightlyPromptResult: { response: 'no', dontAskAgain: true },
			} )
		);
		await writeFile(
			path.join( config, 'cli.json' ),
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
		const env = {
			...process.env,
			DEV_CONFIG_DIR: config,
			STUDIO_PROCESS_MANAGER_HOME: path.join( directory, 'daemon' ),
		};
		let app: ElectronApplication | undefined;
		let server: ReturnType< typeof spawn > | undefined;
		let page = browserPage;
		let origin = '';
		try {
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
				app = await electron.launch( {
					...packagedApp( [ `--user-data-dir=${ path.join( directory, 'electron' ) }` ] ),
					env: desktopEnv,
				} );
				page = await app.firstWindow();
				await page.waitForLoadState( 'domcontentloaded' );
				const sites = await page.evaluate( () => window.ipcApi.getSiteDetails() );
				await app.evaluate( ( { ipcMain }, details ) => {
					ipcMain.removeHandler( 'getSiteDetails' );
					ipcMain.handle( 'getSiteDetails', async () => details );
				}, sites );
			} else {
				const port = await portFinder.getOpenPort();
				server = spawn(
					process.execPath,
					[ 'apps/cli/dist/cli/main.mjs', 'ui', '--no-open', '--port', String( port ) ],
					{ cwd: process.cwd(), env, stdio: [ 'ignore', 'pipe', 'pipe' ] }
				);
				origin = await new Promise< string >( ( resolve, reject ) => {
					let output = '';
					server!.stdout!.on( 'data', ( chunk: Buffer ) => {
						output += chunk.toString();
						const url = output.match( /http:\/\/localhost:\d+/ )?.[ 0 ];
						if ( url ) resolve( url );
					} );
					server!.stderr!.on( 'data', ( chunk: Buffer ) => {
						output += chunk.toString();
					} );
					server!.once( 'error', reject );
					server!.once( 'exit', () => reject( new Error( output ) ) );
				} );
			}

			const errors: string[] = [];
			page.on( 'pageerror', ( error ) => errors.push( error.message ) );
			for ( const scheme of [ 'light', 'dark' ] as const ) {
				if ( app )
					await app.evaluate( ( { BrowserWindow } ) =>
						BrowserWindow.getAllWindows()[ 0 ].setSize( 1100, 820 )
					);
				else await page.setViewportSize( { width: 1100, height: 820 } );
				if ( app ) {
					await page.evaluate(
						( value ) => window.ipcApi.setUserPreferences( { colorScheme: value } ),
						scheme
					);
					await page.reload();
				} else {
					await page.request.patch( `${ origin }/api/user-preferences`, {
						data: { colorScheme: scheme },
					} );
					await page.goto( origin );
				}
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
				await fileInput.evaluate( ( element ) => {
					const body = element.closest( '[data-slot="input-group"]' )!;
					const dataTransfer = new DataTransfer();
					dataTransfer.items.add( ( element as HTMLInputElement ).files![ 0 ] );
					body.dispatchEvent(
						new DragEvent( 'dragenter', { bubbles: true, cancelable: true, dataTransfer } )
					);
				} );
				const overlay = page.getByText( 'Drop to attach', { exact: true } ).locator( '..' );
				const pane = overlay.locator( '..' );
				await expect( overlay ).toBeVisible();
				expect( await overlay.boundingBox() ).toEqual( await pane.boundingBox() );
				await page.screenshot( { path: info.outputPath( `${ host }-drop-${ scheme }.png` ) } );
				await fileInput.evaluate( ( element ) => {
					const body = element.closest( '[data-slot="input-group"]' )!;
					const dataTransfer = new DataTransfer();
					dataTransfer.items.add( ( element as HTMLInputElement ).files![ 0 ] );
					body.dispatchEvent(
						new DragEvent( 'drop', { bubbles: true, cancelable: true, dataTransfer } )
					);
				} );
				await expect( overlay ).toHaveCount( 0 );
				const composer = page.locator( '[data-slot="input-group"][data-variant="composer"]' );
				await expect( composer.getByRole( 'button', { name: 'Remove attachment' } ) ).toHaveCount(
					1
				);
				const imagePath = info.outputPath( 'reference.png' );
				await page.screenshot( { path: imagePath } );
				await page.getByLabel( 'Upload attachments' ).setInputFiles( imagePath );
				await expect( composer.getByRole( 'button', { name: 'Remove attachment' } ) ).toHaveCount(
					2
				);
				const image = composer.locator( 'img' );
				const imageBounds = await image.boundingBox();
				expect( imageBounds!.width ).toBeCloseTo( 96, 0 );
				expect( imageBounds!.y + imageBounds!.height ).toBeLessThan(
					( await input.boundingBox() )!.y
				);
				for ( const remove of await composer
					.getByRole( 'button', { name: 'Remove attachment' } )
					.all() ) {
					expect(
						await remove.evaluate( ( element ) => getComputedStyle( element ).opacity )
					).toBe( '1' );
				}
				await page.screenshot( {
					path: info.outputPath( `${ host }-attachments-${ scheme }.png` ),
				} );
				if ( app )
					await app.evaluate( ( { BrowserWindow } ) =>
						BrowserWindow.getAllWindows()[ 0 ].setSize( 640, 820 )
					);
				else await page.setViewportSize( { width: 640, height: 820 } );
				expect(
					await composer.evaluate( ( element ) => element.scrollWidth - element.clientWidth )
				).toBe( 0 );
				await page.screenshot( {
					path: info.outputPath( `${ host }-attachments-narrow-${ scheme }.png` ),
				} );
				await composer.getByRole( 'button', { name: 'Remove attachment' } ).first().click();
				await composer.getByRole( 'button', { name: 'Remove attachment' } ).click();
				await expect( input ).toHaveValue( 'Use these references' );
			}
			expect( errors ).toEqual( [] );
		} finally {
			await app?.close();
			if ( server && server.exitCode === null && server.signalCode === null ) {
				await page.close();
				const stopped = new Promise( ( resolve ) => server!.once( 'exit', resolve ) );
				server.kill( 'SIGTERM' );
				const forceStop = setTimeout( () => server!.kill( 'SIGKILL' ), 3000 );
				await stopped;
				clearTimeout( forceStop );
			}
			await rm( directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } );
		}
	} );
}
