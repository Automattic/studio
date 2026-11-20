import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getRemoteSites } from '@studio/common/lib/remote-sites';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getSiteVersion } from 'cli/lib/site-versions';
import { getDestinationStatus } from '../publish-status';
import type { ConfigSite as SiteData } from '@studio/common/lib/config/schema';
import type { SyncSite } from '@studio/common/types/sync';

vi.mock( '@studio/common/lib/remote-sites' );
vi.mock( 'cli/lib/cli-config/sites', () => ( { getSiteByFolder: vi.fn() } ) );
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
} );
afterEach( () => {
	vi.unstubAllEnvs();
	fs.rmSync( root, { recursive: true, force: true } );
} );
it( 'uses the same contents comparison as previews and notices edits, additions and deletions', async () => {
	remote.localVersionId = await getSiteVersion( 'local', sitePath );
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: false } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'theme.css' ), 'edited theme' );
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: true } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'theme.css' ), 'old' );
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: false } );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'new.php' ), '<?php' );
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: true } );
	fs.unlinkSync( path.join( sitePath, 'wp-content', 'new.php' ) );
	fs.unlinkSync( path.join( sitePath, 'wp-content', 'theme.css' ) );
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: true } );
} );
it( 'keeps untracked connections unknown', async () => {
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 42, provider: 'wpcom' } )
	).toMatchObject( { localChanged: null } );
} );
it( 'rejects a destination that is not connected to this local site', async () => {
	await expect(
		getDestinationStatus( { siteFolder: sitePath, remoteSiteId: 99, provider: 'wpcom' } )
	).rejects.toThrow( 'Connected site not found' );
} );

it( 'compares destinations independently across providers, including identical ids', async () => {
	const before = await getSiteVersion( 'local', sitePath );
	fs.writeFileSync( path.join( sitePath, 'wp-content', 'theme.css' ), 'updated theme' );
	const after = await getSiteVersion( 'local', sitePath );
	vi.mocked( getRemoteSites ).mockImplementation( async ( provider ) => [
		{ ...remote, localVersionId: provider === 'wpcom' ? before : after },
	] );
	expect(
		await getDestinationStatus( { siteFolder: sitePath, remoteSiteId: '42', provider: 'wpcom' } )
	).toMatchObject( { localChanged: true } );
	expect(
		await getDestinationStatus( {
			siteFolder: sitePath,
			remoteSiteId: '42',
			provider: 'spacefast',
		} )
	).toMatchObject( { localChanged: false } );
} );
