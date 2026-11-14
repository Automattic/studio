import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPreviewStatus } from 'cli/commands/preview/status';
import { findSiteById } from 'cli/lib/cli-config/sites';
import { getPreviewEditedAt } from 'cli/lib/preview-sites';
import { getSiteVersion } from 'cli/lib/site-versions';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/wpcom-auth', () => ( {
	requireAuthToken: vi.fn().mockResolvedValue( { id: 1, accessToken: 'token' } ),
} ) );
vi.mock( 'cli/lib/cli-config/sites', () => ( { findSiteById: vi.fn() } ) );
vi.mock( 'cli/lib/preview-sites', () => ( { getPreviewEditedAt: vi.fn() } ) );
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
		vi.mocked( findSiteById ).mockResolvedValue( { id: 'one', path: sitePath } as SiteData );
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
		vi.mocked( getPreviewEditedAt ).mockResolvedValue( previewEditedAt );
		if ( editLocal ) {
			fs.writeFileSync( path.join( sitePath, 'wp-content', 'style.css' ), 'body {}' );
		}

		expect( await getPreviewStatus( 'preview.wpcomstaging.com' ) ).toEqual( {
			localSiteId: 'one',
			...expected,
		} );
	} );

	it.each( [ false, true ] )(
		'preserves local change status when the remote check fails (%s)',
		async ( editLocal ) => {
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
			vi.mocked( getPreviewEditedAt ).mockRejectedValue(
				new Error( 'Sorry, you are not allowed to access the templates on this site.' )
			);
			if ( editLocal )
				fs.writeFileSync( path.join( sitePath, 'wp-content', 'style.css' ), 'body {}' );
			expect( await getPreviewStatus( 'preview.wpcomstaging.com' ) ).toEqual( {
				localSiteId: 'one',
				localChanged: editLocal,
				previewChanged: null,
			} );
		}
	);

	it( "can't tell for a preview synced before Studio recorded versions", async () => {
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
			{ url: 'preview.wpcomstaging.com', atomicSiteId: 7, localSiteId: 'one', date: 2000 },
		] );

		expect( await getPreviewStatus( 'preview.wpcomstaging.com' ) ).toEqual( {
			localSiteId: 'one',
			localChanged: null,
			previewChanged: null,
		} );
		expect( getPreviewEditedAt ).not.toHaveBeenCalled();
	} );
} );
