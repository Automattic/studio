import path from 'path';
import { test, expect } from '@playwright/test';
import cliPackageJson from '../../cli/package.json';
import { E2ESession } from './e2e-helpers';
import Sidebar from './page-objects/sidebar';
import { PREVIOUS_RELEASE_ENV, daemonRequest, preparePreviousRelease } from './previous-release';

type ProcessDescription = { name: string; status: string; pid?: number };

const session = new E2ESession();

async function onlinePid( siteId: string ) {
	const { processes } = await daemonRequest( session.daemonHomePath, 'list-processes' );
	return ( processes as ProcessDescription[] ).find(
		( process ) => process.name === `studio-site-${ siteId }` && process.status === 'online'
	)?.pid;
}

test.afterAll( async () => {
	// Quitting then stops the sites and the daemon, which "leave running" would leave behind.
	await session.mainWindow
		?.evaluate( () => window.ipcApi.setUserPreferences( { quitSitesBehavior: 'stop' } ) )
		.catch( () => {} );
	await session.cleanup();
} );

test( 'starts the sites the previous version left running again after an update', async () => {
	test.setTimeout( 600_000 );
	const previousRelease = await preparePreviousRelease();
	session.appPath = previousRelease.appPath;
	await session.launch( PREVIOUS_RELEASE_ENV, { appData: { quitSitesBehavior: 'leave-running' } } );

	// Driven through IPC rather than the previous version's UI, which the page objects don't follow.
	const studioDir = path.join( session.homePath, 'Studio' );
	const siteIds = await session.mainWindow.evaluate(
		async ( [ runningPath, stoppedPath ] ) => {
			const running = await window.ipcApi.createSite( runningPath, { siteName: 'Kept Running' } );
			const stopped = await window.ipcApi.createSite( stoppedPath, { siteName: 'Left Stopped' } );
			await window.ipcApi.stopServer( stopped.id );
			return { running: running.id, stopped: stopped.id };
		},
		[ path.join( studioDir, 'kept-running' ), path.join( studioDir, 'left-stopped' ) ]
	);
	await expect.poll( () => onlinePid( siteIds.running ), { timeout: 120_000 } ).toBeDefined();
	const oldPid = await onlinePid( siteIds.running );

	await session.closeApp();
	// Quitting left the previous version's daemon running with the site.
	expect( ( await daemonRequest( session.daemonHomePath, 'ping' ) ).version ).toBe(
		previousRelease.version
	);
	expect( await onlinePid( siteIds.running ) ).toBe( oldPid );

	session.appPath = undefined;
	await session.launchFirstWindow();

	const sidebar = new Sidebar( session.mainWindow );
	await sidebar.expectRunning( 'Kept Running' );
	await expect( sidebar.getStatusButton( 'Left Stopped' ) ).toHaveAttribute(
		'data-state',
		'stopped'
	);
	expect( ( await daemonRequest( session.daemonHomePath, 'ping' ) ).version ).toBe(
		cliPackageJson.version
	);
	await expect
		.poll(
			async () => {
				const pid = await onlinePid( siteIds.running );
				return pid !== undefined && pid !== oldPid;
			},
			{ timeout: 120_000, message: 'The upgraded daemon restarts the previously running site' }
		)
		.toBe( true );
	expect( await onlinePid( siteIds.stopped ) ).toBeUndefined();

	const response = await fetch( await session.getSiteUrl( 'Kept Running' ), {
		redirect: 'manual',
	} );
	expect( response.status ).toBeLessThan( 500 );
} );
