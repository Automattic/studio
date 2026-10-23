import path from 'path';
import { test, expect } from '@playwright/test';
import { pathExists } from '@studio/common/lib/fs-utils';
import fs from 'fs-extra';
import { E2ESession, launchWithSite } from './e2e-helpers';
import Sidebar from './page-objects/sidebar';

const session = new E2ESession();

test.describe( 'Sites without cleanup in-between', () => {
	test.afterEach( async ( { page: _page }, testInfo ) => {
		await session.reportMainProcessLogsOnFailure( testInfo );
	} );

	test.afterAll( async () => {
		await session.cleanup();
	} );

	test( 'duplicating from the sidebar copies all files and the thumbnail', async () => {
		const { siteName, site } = await launchWithSite( session );

		const thumbnailsDir = path.join( session.appDataPath, 'Studio', 'thumbnails' );
		await fs.ensureDir( thumbnailsDir );
		await fs.writeFile( path.join( thumbnailsDir, `${ site.id }.png` ), 'test-thumbnail-data' );

		await new Sidebar( session.mainWindow ).openContextMenuItem( siteName, 'Duplicate' );

		const copyName = `${ siteName } Copy`;
		await expect( new Sidebar( session.mainWindow ).getSiteButton( copyName ) ).toBeVisible( {
			timeout: 120_000,
		} );
		const copy = await session.waitForSite( copyName );
		expect( await pathExists( path.join( copy.path, 'wp-config.php' ) ) ).toBe( true );
		await expect
			.poll( () => pathExists( path.join( thumbnailsDir, `${ copy.id }.png` ) ) )
			.toBe( true );
	} );

	test( 'stop all sites and then start the first site again', async () => {
		const sidebar = new Sidebar( session.mainWindow );
		await session.stopAllSites();

		const [ first ] = await session.getSites();
		await expect( sidebar.getStatusButton( first.name ) ).toHaveAttribute(
			'data-state',
			'stopped',
			{
				timeout: 120_000,
			}
		);

		await sidebar.getStatusButton( first.name ).click();
		await sidebar.expectRunning( first.name );
	} );
} );
