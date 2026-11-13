import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRemoteSites } from '@studio/common/lib/remote-sites';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getSnapshotsFromConfig } from 'cli/lib/cli-config/snapshots';
import { getSiteVersion } from 'cli/lib/site-versions';
import { runCommand } from '../publish-status';
import type { SyncSite } from '@studio/common/types/sync';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( '@studio/common/lib/remote-sites' );
vi.mock( '@studio/common/lib/shared-config', () => ( { getCurrentUserId: async () => 7 } ) );
vi.mock( 'cli/lib/cli-config/sites', () => ( { getSiteByFolder: vi.fn() } ) );
vi.mock( 'cli/lib/cli-config/snapshots', () => ( { getSnapshotsFromConfig: vi.fn() } ) );
let root: string;
let sitePath: string;
let remote: SyncSite;
beforeEach( () => {
	root = fs.mkdtempSync( path.join( os.tmpdir(), 'publish-status-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', path.join( root, 'config' ) );
	sitePath = path.join( root, 'site' );
	fs.mkdirSync( path.join( sitePath, 'wp-content' ), { recursive: true } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'theme.css' ), 'old' );
	vi.mocked( getSiteByFolder ).mockResolvedValue( { id: 'local', path: sitePath } as SiteData );
	remote = {
		id: 42,
		localSiteId: 'local',
		isPressable: false,
		lastPushTimestamp: null,
		lastPullTimestamp: null,
	} as SyncSite;
	vi.mocked( getRemoteSites ).mockResolvedValue( [ remote ] );
	vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [] );
} );
afterEach( () => {
	vi.unstubAllEnvs();
	fs.rmSync( root, { recursive: true, force: true } );
} );
it( 'uses the same contents comparison as previews and notices edits, additions and deletions', async () => {
	remote.localVersionId = await getSiteVersion( 'local', sitePath );
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: false } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'theme.css' ), 'edited theme' );
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: true } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'theme.css' ), 'old' );
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: false } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'new.php' ), '<?php' );
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: true } );
	fs.unlinkSync( path.join( sitePath, 'wp-content', 'new.php' ) );
	fs.unlinkSync( path.join( sitePath, 'wp-content', 'theme.css' ) );
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: true } );
} );
it( 'keeps untracked connections unknown', async () => {
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: null } );
} );
it( 'reuses the matching upgraded preview baseline independent of its address', async () => {
	vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
		{
			atomicSiteId: 42,
			localSiteId: 'local',
			userId: 7,
			url: 'old.wpcomstaging.com',
			date: 1000,
			syncedAt: 1000,
			versionId: await getSiteVersion( 'local', sitePath ),
		},
	] );
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: false } );
	remote.lastPushTimestamp = new Date( 2000 ).toISOString();
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: null } );
	remote.lastPushTimestamp = null;
	remote.localVersionId = null;
	expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: null } );
} );
it( 'does not use a different preview or a different local site baseline', async () => {
	for ( const [ atomicSiteId, localSiteId ] of [
		[ 99, 'local' ],
		[ 42, 'another' ],
	] as const ) {
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
			{
				atomicSiteId,
				localSiteId,
				userId: 7,
				url: 'old.wpcomstaging.com',
				date: 1000,
				syncedAt: 1000,
				versionId: await getSiteVersion( 'local', sitePath ),
			},
		] );
		expect( await runCommand( sitePath, 42 ) ).toEqual( { localChanged: null } );
	}
	await expect( runCommand( sitePath, 99 ) ).rejects.toThrow( 'Connected site not found' );
} );

it( 'compares destinations independently across providers, including identical ids', async () => {
	const before = await getSiteVersion( 'local', sitePath );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'theme.css' ), 'new' );
	const after = await getSiteVersion( 'local', sitePath );
	vi.mocked( getRemoteSites ).mockImplementation( async ( provider ) => [
		{ ...remote, localVersionId: provider === 'wpcom' ? before : after },
	] );
	expect( await runCommand( sitePath, '42', 'wpcom' ) ).toEqual( { localChanged: true } );
	expect( await runCommand( sitePath, '42', 'spacefast' ) ).toEqual( { localChanged: false } );
	expect( getSnapshotsFromConfig ).not.toHaveBeenCalled();
} );
