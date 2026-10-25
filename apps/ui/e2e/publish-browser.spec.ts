import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { portFinder } from '../../../packages/common/lib/port-finder';
import { startStudioUi } from './desktop-app';

test( 'publishes and pulls from the browser app', async ( { page } ) => {
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
	const studio = await startStudioUi( {
		DEV_CONFIG_DIR: config,
		STUDIO_PROCESS_MANAGER_HOME: path.join( directory, 'daemon' ),
	} );
	try {
		const { origin } = studio;
		await page.route( '**/api/sites/notice-site/site-icon', ( route ) =>
			route.fulfill( { json: null } )
		);

		await page.goto( origin );
		await page.getByRole( 'button', { name: 'Notice verification', exact: true } ).click();
		await expect( page.getByRole( 'button', { name: 'Publish…', exact: true } ) ).toBeHidden();
		await page
			.getByRole( 'button', { name: 'Site actions for Notice verification', exact: true } )
			.click();
		await page.getByRole( 'menuitem', { name: 'Publish', exact: true } ).click();
		const accountDialog = page.getByRole( 'dialog', { name: 'Publish your WordPress' } );
		await expect( accountDialog ).toBeVisible();
		await accountDialog.getByRole( 'button', { name: 'Close', exact: true } ).click();
		await page
			.getByRole( 'combobox', { name: 'Message WordPress Studio' } )
			.press( 'ControlOrMeta+k' );
		const palette = page.getByRole( 'dialog', { name: 'Command palette' } );
		await palette.getByRole( 'combobox' ).fill( 'Publish & Sync' );
		await palette.getByRole( 'option', { name: /^Publish & Sync/ } ).click();
		await expect( accountDialog ).toBeVisible();
		await accountDialog.getByRole( 'button', { name: 'Close', exact: true } ).click();
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
		await page.goto( origin );
		await page.getByRole( 'button', { name: 'Notice verification', exact: true } ).click();
		const openPublishMenu = async ( { contextMenu = false } = {} ) => {
			if ( contextMenu )
				await page
					.getByRole( 'button', { name: 'Notice verification', exact: true } )
					.click( { button: 'right' } );
			else
				await page
					.getByRole( 'button', { name: 'Site actions for Notice verification', exact: true } )
					.click();
			const publish = page.getByRole( 'menuitem', { name: 'Publish', exact: true } );
			await publish.focus();
			await publish.press( 'ArrowRight' );
			await expect( page.getByRole( 'menuitem', { name: 'Publish changes…' } ) ).toBeVisible();
		};
		await openPublishMenu( { contextMenu: true } );
		await page.getByRole( 'menuitem', { name: 'Manage websites…' } ).click();
		await expect( page.getByRole( 'dialog', { name: 'Websites', exact: true } ) ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
		await expect( page.getByRole( 'menu' ) ).toHaveCount( 0 );
		await openPublishMenu();
		await page.getByRole( 'menuitem', { name: 'Publish changes…' } ).click();
		const panel = page.getByRole( 'dialog', { name: 'Publish', exact: true } );
		await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
		await panel.getByRole( 'combobox', { name: 'What to publish' } ).click();
		await page.getByRole( 'option', { name: 'Choose files…' } ).click();
		const files = page.getByRole( 'dialog', { name: 'Choose files', exact: true } );
		await expect(
			files.getByText(
				'Individual files are unavailable here. Use Files only to include all files.'
			)
		).toBeVisible();
		await files.getByText( 'Content and settings', { exact: true } ).click();
		await expect(
			files.getByRole( 'checkbox', { name: 'Content and settings', exact: true } )
		).toBeChecked();
		await files.getByRole( 'button', { name: 'Done', exact: true } ).click();
		await panel.getByRole( 'combobox', { name: 'What to publish' } ).click();
		await page.getByRole( 'option', { name: 'Files only', exact: true } ).click();
		await panel.getByRole( 'button', { name: 'Publish', exact: true } ).click();
		await expect.poll( () => Boolean( finishPublish ) ).toBe( true );
		finishPublish!();
		await expect( panel.getByRole( 'button', { name: 'Publish', exact: true } ) ).toBeEnabled();
		await panel.getByRole( 'button', { name: 'Website actions' } ).click();
		await page.getByRole( 'menuitem', { name: 'Pull changes…' } ).click();
		const pull = page.getByRole( 'dialog', { name: 'Pull changes', exact: true } );
		await pull.getByRole( 'combobox', { name: 'What to pull' } ).click();
		await page.getByRole( 'option', { name: 'Content and settings only', exact: true } ).click();
		await expect(
			pull.getByText(
				'All content and settings in WordPress Studio will be overwritten. Your website stays unchanged.'
			)
		).toBeVisible();
		await pull.getByRole( 'button', { name: 'Pull changes', exact: true } ).click();
		await expect( pull.getByText( 'Changes pulled into WordPress Studio' ) ).toBeVisible();
		await pull.getByRole( 'button', { name: 'Done', exact: true } ).click();
		await expect( panel.getByRole( 'combobox', { name: 'What to publish' } ) ).toContainText(
			'Files only'
		);
		await page.keyboard.press( 'Escape' );
		expect( transfers.map( ( item ) => item.direction ) ).toEqual( [ 'push', 'pull' ] );
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
	} finally {
		await page.close();
		await studio.stop();
		await rm( directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } );
	}
} );
