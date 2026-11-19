import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPreviewStatus } from 'cli/commands/preview/status';
import { findSiteById } from 'cli/lib/cli-config/sites';
import { getSiteVersion } from 'cli/lib/site-versions';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';
import { wpcomSites } from 'cli/lib/sync-api';
import type { ConfigSite } from '@studio/common/lib/config/schema';

vi.mock( 'cli/lib/wpcom-auth', () => ( {
	requireAuthToken: vi.fn().mockResolvedValue( { id: 1, accessToken: 'token' } ),
} ) );
vi.mock( 'cli/lib/cli-config/sites', () => ( { findSiteById: vi.fn() } ) );
vi.mock( 'cli/lib/sync-api', () => ( { wpcomSites: { editedAt: vi.fn() } } ) );
vi.mock( 'cli/lib/snapshots', () => ( { getSnapshotsFromConfig: vi.fn() } ) );

describe( 'getPreviewStatus', () => {
	let root: string;
	let sitePath: string;

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'preview-status-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', path.join( root, 'config' ) );
		sitePath = path.join( root, 'site' );
		fs.mkdirSync( path.join( sitePath, 'wp-content' ), { recursive: true } );
		fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), '<?php' );
		vi.mocked( findSiteById ).mockResolvedValue( { id: 'one', path: sitePath } as ConfigSite );
	} );

	afterEach( () => {
		vi.unstubAllEnvs();
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it.each( [
		[ 'neither side changed', false, 1000, { localChanged: false, previewChanged: false } ],
		[ 'the local site changed', true, 1000, { localChanged: true, previewChanged: false } ],
		[ 'the preview was edited', false, 3000, { localChanged: false, previewChanged: true } ],
		[ 'both changed', true, 3000, { localChanged: true, previewChanged: true } ],
	] )( 'reports %s since the last sync', async ( _, editLocal, previewEditedAt, expected ) => {
		const versionId = await getSiteVersion( 'one', sitePath );
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
			{
				url: 'preview.wpcomstaging.com',
				atomicSiteId: 7,
				localSiteId: 'one',
				date: 2000,
				versionId,
				syncedAt: 2000,
			},
		] );
		vi.mocked( wpcomSites.editedAt! ).mockResolvedValue( previewEditedAt );
		if ( editLocal ) {
			fs.writeFileSync( path.join( sitePath, 'wp-content', 'style.css' ), 'body {}' );
		}

		expect( await getPreviewStatus( 'preview.wpcomstaging.com' ) ).toEqual( {
			localSiteId: 'one',
			...expected,
		} );
	} );

	it( "can't tell for a preview synced before Studio recorded versions", async () => {
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
			{ url: 'preview.wpcomstaging.com', atomicSiteId: 7, localSiteId: 'one', date: 2000 },
		] );

		expect( await getPreviewStatus( 'preview.wpcomstaging.com' ) ).toEqual( {
			localSiteId: 'one',
			localChanged: null,
			previewChanged: null,
		} );
		expect( wpcomSites.editedAt ).not.toHaveBeenCalled();
	} );
} );
