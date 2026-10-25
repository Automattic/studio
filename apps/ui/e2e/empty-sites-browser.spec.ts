import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';

test( 'offers site creation on empty browser launch in both themes', async ( { page }, info ) => {
	const directory = await mkdtemp( path.join( tmpdir(), 'se-' ) );
	const config = path.join( directory, 'config' );
	await mkdir( config );
	await mkdir( path.join( directory, 'daemon' ) );
	await writeFile(
		path.join( config, 'app.json' ),
		JSON.stringify( { version: 1, defaultSiteDirectory: path.join( directory, 'sites' ) } )
	);
	await writeFile(
		path.join( config, 'shared.json' ),
		JSON.stringify( { version: 1, analyticsOptOut: true } )
	);
	const port = await portFinder.getOpenPort();
	const server = spawn(
		process.execPath,
		[ 'apps/cli/dist/cli/main.mjs', 'ui', '--no-open', '--port', String( port ) ],
		{
			cwd: path.resolve( import.meta.dirname, '../../..' ),
			env: {
				...process.env,
				DEV_CONFIG_DIR: config,
				STUDIO_PROCESS_MANAGER_HOME: path.join( directory, 'daemon' ),
			},
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);
	const serverUrl = new Promise< string >( ( resolve, reject ) => {
		let output = '';
		server.stdout.on( 'data', ( chunk: Buffer ) => {
			output += chunk.toString();
			const url = output.match( /http:\/\/localhost:\d+/ )?.[ 0 ];
			if ( url ) resolve( url );
		} );
		server.stderr.on( 'data', ( chunk: Buffer ) => {
			output += chunk.toString();
		} );
		server.once( 'error', reject );
		server.once( 'exit', () =>
			reject( new Error( output || 'Studio server exited before startup' ) )
		);
	} );
	try {
		const origin = await serverUrl;
		await expect
			.poll( async () => {
				try {
					return ( await page.request.get( `${ origin }/api/health` ) ).ok();
				} catch {
					return false;
				}
			} )
			.toBe( true );
		for ( const scheme of [ 'light', 'dark' ] as const ) {
			await page.request.patch( `${ origin }/api/user-preferences`, {
				data: { colorScheme: scheme },
			} );
			await page.goto( origin );
			const dialog = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
			await expect( dialog ).toBeVisible();
			await expect(
				page.getByRole( 'button', { name: 'Settings', exact: true, includeHidden: true } )
			).toHaveCSS( 'visibility', 'visible' );
			await expect(
				page.getByRole( 'button', { name: 'Hide sidebar', exact: true, includeHidden: true } )
			).toHaveCSS( 'visibility', 'visible' );
			await expect(
				dialog.getByRole( 'heading', { name: 'Choose a starting point', exact: true } )
			).toBeVisible();
			await expect( dialog.getByRole( 'searchbox' ) ).toHaveCount( 0 );
			await expect( dialog.getByRole( 'combobox', { name: 'Blueprint collection' } ) ).toHaveCount(
				0
			);
			await expect( dialog.getByRole( 'button', { name: 'Start with Blank site' } ) ).toBeFocused();
			await expect.poll( async () => ( await dialog.boundingBox() )?.height ).toBe( 624 );
			const bounds = ( await dialog.boundingBox() )!;
			expect( bounds.width ).toBe( 896 );
			expect( bounds.y ).toBeGreaterThanOrEqual( 16 );
			expect( bounds.y + bounds.height ).toBeLessThanOrEqual( page.viewportSize()!.height - 16 );
			expect(
				await dialog.evaluate( ( element ) => getComputedStyle( element ).borderRadius )
			).toBe( '16px' );
			await dialog.getByRole( 'tab', { name: 'Create', exact: true } ).click();
			await page.keyboard.press( 'ArrowDown' );
			await page.keyboard.press( 'ArrowDown' );
			await page.keyboard.press( 'ArrowDown' );
			await expect( dialog.getByRole( 'tab', { name: 'Business', exact: true } ) ).toBeFocused();
			await dialog.getByRole( 'tab', { name: 'Blog', exact: true } ).click();
			await expect(
				dialog.getByRole( 'button', { name: 'View Skincare Blog', exact: true } )
			).toBeVisible();
			await expect(
				dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } )
			).toBeHidden();
			await dialog.getByRole( 'tab', { name: 'Create', exact: true } ).click();
			await page.screenshot( { path: info.outputPath( `picker-browser-${ scheme }.png` ) } );
			await dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } ).click();
			await expect(
				dialog.getByRole( 'heading', { name: 'Wedding RSVP', level: 1 } )
			).toBeVisible();
			await expect( dialog.getByRole( 'tablist' ) ).toHaveCount( 0 );
			await expect( dialog.getByRole( 'button', { name: 'Create site' } ) ).toBeFocused();
			await expect( dialog.getByRole( 'button', { name: 'Create site' } ) ).toHaveAttribute(
				'data-variant',
				'accent'
			);
			const closeInsets = await dialog
				.getByRole( 'button', { name: 'Close Add site' } )
				.evaluate( ( button ) => {
					const surface = button.closest( '[role="dialog"]' )!.getBoundingClientRect();
					const close = button.getBoundingClientRect();
					return { top: close.top - surface.top, right: surface.right - close.right };
				} );
			expect( closeInsets.right ).toBeCloseTo( closeInsets.top, 0 );
			const backInsets = await dialog
				.getByRole( 'button', { name: 'Back to Blueprints' } )
				.evaluate( ( button ) => {
					const surface = button.closest( '[role="dialog"]' )!.getBoundingClientRect();
					const back = button.getBoundingClientRect();
					return { top: back.top - surface.top, left: back.left - surface.left };
				} );
			expect( backInsets.left ).toBe( 16 );
			expect( backInsets.top ).toBe( 14 );
			await expect
				.poll( () =>
					dialog
						.getByRole( 'img', { name: 'Wedding RSVP screenshot' } )
						.evaluate( ( image ) => ( image as HTMLImageElement ).naturalWidth )
				)
				.toBeGreaterThan( 0 );
			await expect( dialog.getByRole( 'img' ) ).toHaveCount( 1 );
			await expect( dialog.getByRole( 'img' ) ).toHaveAccessibleName( 'Wedding RSVP screenshot' );
			expect(
				await dialog
					.locator( '[data-slot="dialog-scroll-area"]' )
					.evaluate( ( element ) => element.scrollHeight - element.clientHeight )
			).toBeLessThan( 2 );
			await page.screenshot( {
				path: info.outputPath( `blueprint-details-browser-${ scheme }.png` ),
			} );
			const useBounds = ( await dialog
				.getByRole( 'button', { name: 'Create site' } )
				.boundingBox() )!;
			const closeBounds = ( await dialog
				.getByRole( 'button', { name: 'Close Add site' } )
				.boundingBox() )!;
			expect( useBounds.x + useBounds.width ).toBeLessThanOrEqual( closeBounds.x );
			await dialog.getByRole( 'button', { name: 'Blueprints', exact: true } ).click();
			await expect(
				dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } )
			).toBeFocused();
			await dialog.getByRole( 'button', { name: 'View Stylish Press', exact: true } ).click();
			await expect( dialog.getByRole( 'img' ) ).toHaveCount( 1 );
			await expect( dialog.getByRole( 'img' ) ).toHaveAccessibleName( 'Stylish Press screenshot' );
			await expect
				.poll( () =>
					dialog
						.getByRole( 'img' )
						.evaluate( ( image ) => ( image as HTMLImageElement ).naturalWidth )
				)
				.toBeGreaterThan( 0 );
			await page.screenshot( { path: info.outputPath( `stylish-press-browser-${ scheme }.png` ) } );
			await dialog.getByRole( 'button', { name: 'Back to Blueprints' } ).click();
			await page.setViewportSize( { width: 560, height: 800 } );
			await expect
				.poll( async () => Math.round( ( await dialog.boundingBox() )!.height ) )
				.toBe( 624 );
			expect(
				await dialog.evaluate( ( element ) => element.scrollWidth - element.clientWidth )
			).toBeLessThan( 2 );
			await page.screenshot( { path: info.outputPath( `picker-narrow-${ scheme }.png` ) } );
			await dialog.getByRole( 'button', { name: 'View Wedding RSVP', exact: true } ).click();
			await expect( dialog.getByRole( 'button', { name: 'Preview in browser' } ) ).toBeVisible();
			expect(
				await dialog.evaluate( ( element ) => element.scrollWidth - element.clientWidth )
			).toBeLessThan( 2 );
			await page.screenshot( {
				path: info.outputPath( `blueprint-details-narrow-${ scheme }.png` ),
			} );
			await dialog.getByRole( 'button', { name: 'Blueprints', exact: true } ).click();
			await page.setViewportSize( { width: 1280, height: 720 } );
			await dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
			await expect( dialog.getByLabel( 'Site name' ) ).toBeFocused();
			await expect( dialog.getByRole( 'tablist' ) ).toHaveCount( 0 );
			await dialog.getByLabel( 'Site name' ).fill( 'Preserved setup draft' );
			await dialog.getByRole( 'button', { name: 'Back', exact: true } ).click();
			await expect( dialog.getByRole( 'tablist', { name: 'Ways to add a site' } ) ).toBeVisible();
			await dialog.getByRole( 'button', { name: 'Start with Blank site' } ).click();
			await expect( page.locator( 'html' ) ).toHaveAttribute( 'data-color-scheme', scheme );
			await page.screenshot( { path: info.outputPath( `empty-browser-${ scheme }.png` ) } );
			await dialog.getByRole( 'button', { name: 'Cancel' } ).click();
			await expect( dialog ).toBeHidden();
			await expect(
				page.getByRole( 'button', { name: 'Add site', exact: true } ).last()
			).toBeFocused();
			await expect( dialog ).toBeHidden();
			await expect( page.getByText( 'Add a local WordPress site to get started.' ) ).toBeVisible();
			for ( const dismiss of [ 'escape', 'close', 'backdrop' ] ) {
				await page.getByRole( 'button', { name: 'Add site', exact: true } ).last().click();
				await expect( dialog ).toBeVisible();
				if ( dismiss === 'escape' ) await page.keyboard.press( 'Escape' );
				else if ( dismiss === 'close' )
					await dialog.getByRole( 'button', { name: 'Close Add site', exact: true } ).click();
				else await page.mouse.click( 4, 4 );
				await expect( dialog ).toBeHidden();
			}
		}
		await page.request.patch( `${ origin }/api/user-preferences`, {
			data: { newSiteBehavior: 'blank' },
		} );
		await page.goto( origin );
		const setup = page.getByRole( 'dialog', { name: 'Add site', exact: true } );
		await expect( setup.getByLabel( 'Site name' ) ).toBeFocused();
		await setup.getByLabel( 'Site name' ).fill( 'Isolated first site' );
		await setup.getByRole( 'button', { name: 'Create site', exact: true } ).click();
		await expect( setup ).toBeHidden( { timeout: 90_000 } );
		const createdSites = await ( await page.request.get( `${ origin }/api/sites` ) ).json();
		expect( createdSites ).toHaveLength( 1 );
		expect( createdSites[ 0 ].path.startsWith( directory ) ).toBe( true );
	} finally {
		await page.close();
		if ( server.exitCode === null && server.signalCode === null ) {
			const stopped = new Promise( ( resolve ) => server.once( 'exit', resolve ) );
			server.kill( 'SIGTERM' );
			const forceStop = setTimeout( () => server.kill( 'SIGKILL' ), 3000 );
			await stopped;
			clearTimeout( forceStop );
		}
		await new Promise( ( resolve ) => {
			const cleanup = spawn(
				process.execPath,
				[ 'apps/cli/dist/cli/main.mjs', 'site', 'stop', '--all' ],
				{
					env: {
						...process.env,
						DEV_CONFIG_DIR: config,
						STUDIO_PROCESS_MANAGER_HOME: path.join( directory, 'daemon' ),
					},
					stdio: 'ignore',
				}
			);
			cleanup.once( 'exit', resolve );
			cleanup.once( 'error', resolve );
		} );
		await rm( directory, { recursive: true, force: true } );
	}
} );
