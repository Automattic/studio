import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSessionEnvironment } from '../manage';
import { createAiSession, loadAiSession } from '../store';

const SITE = { id: 'site-1', name: 'My Site', path: '/tmp/my-site' };

vi.mock( '@studio/common/sites/site-path', () => ( { readSites: async () => [ SITE ] } ) );
vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	readSharedSession: async () => undefined,
} ) );
vi.mock( '@studio/common/ai/sessions/placement', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	readAiSessionPlacement: async () => ( {
		kind: 'site',
		siteId: SITE.id,
		sitePath: SITE.path,
		siteName: SITE.name,
	} ),
} ) );
const connected = vi.hoisted( () => ( { sites: [] as object[] } ) );
vi.mock( '@studio/common/lib/connected-sites', () => ( {
	getConnectedWpcomSitesForLocalSite: async () => connected.sites,
} ) );

describe( 'setSessionEnvironment', () => {
	let root: string;

	beforeEach( async () => {
		root = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-set-env-' ) );
		connected.sites = [
			{ id: 7, name: 'Staging', url: 'https://staging.example', isStaging: true },
			{ id: 42, name: 'Production', url: 'https://mysite.example', isStaging: false },
		];
	} );

	afterEach( () => fs.rm( root, { recursive: true, force: true } ) );

	it( 'switches to the production connection and back to the local site', async () => {
		const { id } = await createAiSession( root, { site: SITE } );

		await setSessionEnvironment( root, id, 'live' );
		let { summary } = await loadAiSession( root, id );
		expect( summary.activeEnvironment ).toBe( 'live' );
		expect( summary.lastSelectedWpcomSiteId ).toBe( 42 );

		await setSessionEnvironment( root, id, 'local' );
		( { summary } = await loadAiSession( root, id ) );
		expect( summary.activeEnvironment ).toBe( 'local' );
	} );

	it( 'refuses Live when the site has no connection', async () => {
		connected.sites = [];
		const { id } = await createAiSession( root, { site: SITE } );

		await expect( setSessionEnvironment( root, id, 'live' ) ).rejects.toThrow(
			'This site is not connected to a WordPress.com site.'
		);
	} );
} );
