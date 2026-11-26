import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { getRemoteSites } from '@studio/common/lib/remote-sites';
import { vi } from 'vitest';
import { wpcomPreviews } from 'cli/lib/preview-sites';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { runCommand } from '../list';
import type { SyncSite } from '@studio/common/types/sync';

vi.mock( 'cli/lib/preview-sites', () => ( { wpcomPreviews: { list: vi.fn() } } ) );
vi.mock( 'cli/lib/sync-api' );

const boughtSite: SyncSite = {
	id: 456,
	name: 'Bought site',
	url: 'https://bought.example.com',
	localSiteId: '',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
};

let directory: string;

beforeEach( () => {
	directory = mkdtempSync( path.join( os.tmpdir(), 'studio-reconcile-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	writeFileSync(
		path.join( directory, 'config.json' ),
		JSON.stringify( {
			version: 1,
			providers: {
				configs: {
					wpcom: { token: 'token', user: { id: 123, email: '', displayName: '' } },
				},
			},
			sites: [ { id: 'local', name: 'Local', path: '/site', port: 8881, phpVersion: '8.3' } ],
			snapshots: [
				{
					url: 'preview.example.com',
					atomicSiteId: 456,
					localSiteId: 'local',
					userId: 123,
					date: 1,
				},
			],
		} )
	);
} );

afterEach( () => {
	vi.unstubAllEnvs();
	rmSync( directory, { recursive: true, force: true } );
} );

// A preview that leaves WordPress.com's standing list was bought when it is still one of the
// user's sites, and ended (expired or deleted) when it is not.
it.each( [
	{ label: 'bought', standing: false, stillASite: true, connects: true },
	{ label: 'expired or deleted', standing: false, stillASite: false, connects: false },
	{ label: 'still standing', standing: true, stillASite: true, connects: false },
] )(
	'listing previews connects a preview to its local site once it is $label',
	async ( scenario ) => {
		vi.mocked( wpcomPreviews.list ).mockResolvedValue(
			scenario.standing
				? [
						{
							id: 456,
							name: '',
							url: 'https://preview.example.com',
							expiresAt: Date.now() + 3600000,
						},
				  ]
				: []
		);
		vi.mocked( fetchSyncableSites ).mockResolvedValue( scenario.stillASite ? [ boughtSite ] : [] );
		const output = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

		try {
			await runCommand( '/site', 'json' );
		} finally {
			output.mockRestore();
		}

		expect( await getRemoteSites( 'wpcom', 'local' ) ).toEqual(
			scenario.connects
				? [ { ...boughtSite, localSiteId: 'local', syncSupport: 'already-connected' } ]
				: []
		);
	}
);
