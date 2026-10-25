import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';

test( 'browser Publish and pull screens work in both themes', async ( { page }, info ) => {
	const pageErrors: string[] = [];
	const consoleErrors: { text: string; url: string }[] = [];
	page.on( 'pageerror', ( error ) => pageErrors.push( error.message ) );
	page.on( 'console', ( message ) => {
		if ( message.type() === 'error' )
			consoleErrors.push( { text: message.text(), url: message.location().url } );
	} );

	const directory = await mkdtemp( path.join( tmpdir(), 'sn-' ) );
	const config = path.join( directory, 'config' );
	const sitePath = path.join( directory, 'site' );
	await mkdir( config );
	await mkdir( sitePath );
	await writeFile( path.join( sitePath, 'notes.txt' ), 'Provider notice verification fixture' );
	await mkdir( path.join( sitePath, 'wp-content', 'database' ), { recursive: true } );
	await mkdir( path.join( directory, 'daemon' ) );
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
		} )
	);
	await writeFile(
		path.join( config, 'cli.json' ),
		JSON.stringify( {
			version: 1,
			sites: [
				{
					id: 'notice-site',
					name: 'Notice verification',
					path: sitePath,
					port: await portFinder.getOpenPort(),
					phpVersion: '8.3',
				},
			],
			snapshots: [],
		} )
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
		await page.route( '**/api/sites/notice-site/site-icon', ( route ) =>
			route.fulfill( { json: null } )
		);

		for ( const scheme of [ 'light', 'dark' ] as const ) {
			await page.setViewportSize( { width: 1100, height: 820 } );
			await page.request.patch( `${ origin }/api/user-preferences`, {
				data: { colorScheme: scheme },
			} );
			await page.goto( origin );
			await page.getByRole( 'button', { name: 'Notice verification', exact: true } ).click();
			await expect( page.locator( 'html' ) ).toHaveAttribute( 'data-color-scheme', scheme );
			await expect( page.getByRole( 'button', { name: 'Publish…', exact: true } ) ).toBeHidden();
			await page
				.getByRole( 'button', { name: 'Site actions for Notice verification', exact: true } )
				.click();
			await page.getByRole( 'menuitem', { name: 'Publish', exact: true } ).click();
			const dialog = page.getByRole( 'dialog', { name: 'Publish your WordPress' } );
			await expect( dialog ).toBeVisible();
			await page.screenshot( {
				path: info.outputPath( `browser-sync-account-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await dialog.getByRole( 'button', { name: 'Close', exact: true } ).click();
			await page
				.getByRole( 'combobox', { name: 'Message WordPress Studio' } )
				.press( 'ControlOrMeta+k' );
			const palette = page.getByRole( 'dialog', { name: 'Command palette' } );
			await palette.getByRole( 'combobox' ).fill( 'Publish & Sync' );
			await palette.getByRole( 'option', { name: /^Publish & Sync/ } ).click();
			await expect( dialog ).toBeVisible();
			await dialog.getByRole( 'button', { name: 'Close', exact: true } ).click();
		}
		const remote = {
			id: 42,
			localSiteId: 'notice-site',
			name: 'Example website',
			url: 'https://example.wordpress.com',
			isStaging: false,
			isPressable: false,
			syncSupport: 'syncable',
			lastPushTimestamp: '2026-10-19T14:00:00Z',
			lastPullTimestamp: null,
		};
		const transfers: { direction: string; body: unknown }[] = [];
		let finishPublish: ( () => void ) | undefined;
		await page.route( '**/api/**', async ( route ) => {
			const url = new URL( route.request().url() );
			if ( url.pathname === '/api/auth/user' )
				return route.fulfill( {
					json: { id: 1, displayName: 'Publishing verification', email: 'test@example.test' },
				} );
			if (
				url.pathname === '/api/wpcom/syncable-sites' ||
				url.pathname === '/api/wpcom/connected-sites' ||
				url.pathname === '/api/sites/notice-site/connected-sites'
			)
				return route.fulfill( { json: [ remote ] } );
			if ( url.pathname.endsWith( '/hosting-php-version' ) )
				return route.fulfill( { json: '8.3' } );
			if ( url.pathname.endsWith( '/latest-rewind-id' ) )
				return route.fulfill( { json: 'backup-1' } );
			if ( url.pathname.endsWith( '/remote-file-tree' ) ) return route.fulfill( { json: {} } );
			if ( url.pathname.endsWith( '/wp-version' ) )
				return route.fulfill( { json: { wpVersion: '6.9' } } );
			if (
				url.pathname === '/api/sites/notice-site/push' ||
				url.pathname === '/api/sites/notice-site/pull'
			) {
				const direction = url.pathname.endsWith( '/push' ) ? 'push' : 'pull';
				transfers.push( { direction, body: route.request().postDataJSON() } );
				if ( direction === 'push' )
					await new Promise< void >( ( resolve ) => {
						finishPublish = resolve;
					} );
				return route.fulfill( { json: {} } );
			}
			return route.fallback();
		} );
		for ( const scheme of [ 'light', 'dark' ] as const ) {
			await page.setViewportSize( { width: 1100, height: 820 } );
			await page.request.patch( `${ origin }/api/user-preferences`, {
				data: { colorScheme: scheme },
			} );
			await page.goto( origin );
			await page.getByRole( 'button', { name: 'Notice verification', exact: true } ).click();
			const openPublishMenu = async () => {
				if ( scheme === 'dark' )
					await page
						.getByRole( 'button', { name: 'Notice verification', exact: true } )
						.click( { button: 'right' } );
				else
					await page
						.getByRole( 'button', { name: 'Site actions for Notice verification', exact: true } )
						.click();
				const publish = page.getByRole( 'menuitem', { name: 'Publish', exact: true } );
				await expect( publish ).toHaveAttribute( 'aria-haspopup', 'menu' );
				await publish.focus();
				await publish.press( 'ArrowRight' );
				await expect( page.getByRole( 'menuitem', { name: 'Publish changes…' } ) ).toBeVisible();
			};
			await openPublishMenu();
			await expect( page.getByRole( 'menuitem', { name: 'View backups' } ) ).toBeVisible();
			await page.screenshot( {
				path: info.outputPath( `browser-publish-menu-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await page.getByRole( 'menuitem', { name: 'Manage websites…' } ).click();
			await expect( page.getByRole( 'dialog', { name: 'Websites', exact: true } ) ).toBeVisible();
			await page.keyboard.press( 'Escape' );
			await openPublishMenu();
			await page.getByRole( 'menuitem', { name: 'Pull changes…' } ).click();
			await expect(
				page
					.getByRole( 'dialog', { name: 'Pull changes', exact: true } )
					.getByRole( 'combobox', { name: 'What to pull' } )
			).toBeEnabled();
			await page.keyboard.press( 'Escape' );
			await openPublishMenu();
			await page.getByRole( 'menuitem', { name: 'Publish changes…' } ).click();
			const panel = page.getByRole( 'dialog', { name: 'Publish', exact: true } );
			await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
			await expect( panel.getByRole( 'button', { name: 'Close', exact: true } ) ).toHaveCount( 0 );
			for ( const width of [ 1100, 640, 320 ] ) {
				await page.setViewportSize( { width, height: 820 } );
				await page.screenshot( {
					path: info.outputPath( `browser-publish-${ scheme }-${ width }.png` ),
					animations: 'disabled',
				} );
				const bounds = await panel.boundingBox();
				expect( bounds!.x ).toBeGreaterThanOrEqual( 0 );
				expect( bounds!.x + bounds!.width ).toBeLessThanOrEqual( width );
			}
			const include = panel.getByRole( 'combobox', { name: 'What to publish' } );
			await include.focus();
			await include.press( 'ArrowDown' );
			await expect( page.getByRole( 'listbox' ) ).toBeVisible();
			await expect( async () => {
				await page.keyboard.press( 'End' );
				await expect( page.getByRole( 'option', { name: 'Choose files…' } ) ).toHaveAttribute(
					'data-highlighted',
					{ timeout: 500 }
				);
			} ).toPass();
			await page.keyboard.press( 'Enter' );
			const files = page.getByRole( 'dialog', { name: 'Choose files', exact: true } );
			await expect( files.getByRole( 'button', { name: 'Back to Publish' } ) ).toBeFocused();
			await expect(
				files.getByText(
					'Individual files are unavailable here. Use Files only to include all files.'
				)
			).toBeVisible();
			if ( scheme === 'light' )
				await files.getByText( 'Content and settings', { exact: true } ).click();
			await expect(
				files.getByRole( 'checkbox', { name: 'Content and settings', exact: true } )
			).toBeChecked();
			await files.getByRole( 'button', { name: 'Done', exact: true } ).click();
			await panel.getByRole( 'combobox', { name: 'What to publish' } ).click();
			await page.getByRole( 'option', { name: 'Files only', exact: true } ).click();
			await panel.getByRole( 'button', { name: 'Publish', exact: true } ).click();
			await expect( page.getByRole( 'button', { name: 'Publish…', exact: true } ) ).toBeHidden();
			await page.emulateMedia( { reducedMotion: 'reduce' } );
			await expect
				.poll( async () =>
					page
						.locator( '[data-publish-transfer] circle' )
						.first()
						.evaluate( ( element ) => getComputedStyle( element ).animationName )
				)
				.toBe( 'none' );
			await page.screenshot( {
				path: info.outputPath( `browser-publishing-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await expect.poll( () => Boolean( finishPublish ) ).toBe( true );
			finishPublish!();
			finishPublish = undefined;
			await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
			await page.emulateMedia( { reducedMotion: 'no-preference' } );
			await panel.getByRole( 'button', { name: 'Website actions' } ).click();
			await page.getByRole( 'menuitem', { name: 'Pull changes…' } ).click();
			const pull = page.getByRole( 'dialog', { name: 'Pull changes', exact: true } );
			await expect( pull.getByRole( 'button', { name: 'Back to Publish' } ) ).toBeFocused();
			await expect( pull.getByRole( 'combobox', { name: 'What to pull' } ) ).toBeEnabled();
			await pull.getByRole( 'combobox', { name: 'What to pull' } ).click();
			await page.getByRole( 'option', { name: 'Content and settings only', exact: true } ).click();
			await expect(
				pull.getByText(
					'All content and settings in WordPress Studio will be overwritten. Your website stays unchanged.'
				)
			).toBeVisible();
			await page.screenshot( {
				path: info.outputPath( `browser-pull-${ scheme }.png` ),
				animations: 'disabled',
			} );
			await pull.getByRole( 'button', { name: 'Pull changes', exact: true } ).click();
			await expect( pull.getByText( 'Changes pulled into WordPress Studio' ) ).toBeVisible();
			await pull.getByRole( 'button', { name: 'Done', exact: true } ).click();
			await expect( panel.getByRole( 'combobox', { name: 'What to publish' } ) ).toContainText(
				'Files only'
			);
			await page.keyboard.press( 'Escape' );
		}
		expect( transfers.map( ( item ) => item.direction ) ).toEqual( [
			'push',
			'pull',
			'push',
			'pull',
		] );
		expect( transfers[ 0 ].body ).toEqual( {
			remoteSiteId: 42,
			options: { optionsToSync: [ 'plugins', 'themes', 'uploads', 'contents' ] },
		} );
		expect( transfers[ 1 ].body ).toEqual( {
			remoteSiteId: 42,
			options: { optionsToSync: [ 'sqls' ] },
		} );
		await expect( page ).toHaveTitle( 'WordPress Studio' );
		await expect( page.locator( 'vite-error-overlay' ) ).toHaveCount( 0 );
		expect( pageErrors ).toEqual( [] );
		expect(
			consoleErrors.filter(
				( error ) => ! error.url.startsWith( 'https://www.gravatar.com/avatar/' )
			)
		).toEqual( [] );
		console.log( 'Publish browser console errors:', JSON.stringify( consoleErrors ) );
	} finally {
		await page.close();
		if ( server.exitCode === null && server.signalCode === null ) {
			const stopped = new Promise( ( resolve ) => server.once( 'exit', resolve ) );
			server.kill( 'SIGTERM' );
			const forceStop = setTimeout( () => server.kill( 'SIGKILL' ), 3000 );
			await stopped;
			clearTimeout( forceStop );
		}
		await rm( directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } );
	}
} );
