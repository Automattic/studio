import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import {
	readAuthToken,
	readSharedConfig,
	saveSharedConfig,
} from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import { readCliConfig, saveCliConfig } from 'cli/lib/cli-config/core';
import { getStandingPreviews } from 'cli/lib/preview-sites';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { runCommand } from '../list';
import type { SyncSite } from '@studio/common/types/sync';

vi.mock( 'cli/lib/cli-config/core' );
vi.mock( 'cli/lib/preview-sites', async ( original ) => ( {
	...( await original< typeof import('cli/lib/preview-sites') >() ),
	getStandingPreviews: vi.fn(),
} ) );
vi.mock( 'cli/lib/sync-api' );
vi.mock( '@studio/common/lib/shared-config', async ( original ) => ( {
	...( await original< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
	getCurrentUserId: vi.fn().mockResolvedValue( 123 ),
	readSharedConfig: vi.fn(),
	saveSharedConfig: vi.fn(),
	lockSharedConfig: vi.fn(),
	unlockSharedConfig: vi.fn(),
} ) );

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

// A preview that leaves WordPress.com's standing list was bought when it is still one of the
// user's sites, and ended (expired or deleted) when it is not.
it.each( [
	{ label: 'bought', standing: false, stillASite: true, connects: true },
	{ label: 'expired or deleted', standing: false, stillASite: false, connects: false },
	{ label: 'still standing', standing: true, stillASite: true, connects: false },
	{
		label: 'bought after a transient error',
		standing: false,
		stillASite: true,
		connects: true,
		retry: true,
	},
] )(
	'listing previews connects a preview to its local site once it is $label',
	async ( scenario ) => {
		vi.mocked( readAuthToken ).mockResolvedValue( {
			id: 123,
			accessToken: 'token',
			email: '',
			displayName: '',
			expiresIn: 3600,
			expirationTime: Date.now() + 3600000,
		} );
		let shared: Awaited< ReturnType< typeof readSharedConfig > > = {
			version: 1,
			connectedWpcomSites: {},
		};
		vi.mocked( readSharedConfig ).mockImplementation( async () => structuredClone( shared ) );
		vi.mocked( saveSharedConfig ).mockImplementation( async ( config ) => {
			shared = config;
		} );
		let config = {
			version: 1 as const,
			sites: [],
			snapshots: [
				{
					url: 'preview.example.com',
					atomicSiteId: 456,
					localSiteId: 'local',
					userId: 123,
					date: 1,
				},
			],
		};
		vi.mocked( readCliConfig ).mockImplementation( async () => structuredClone( config ) );
		vi.mocked( saveCliConfig ).mockImplementation( async ( saved ) => {
			config = saved as typeof config;
		} );
		vi.mocked( getStandingPreviews ).mockResolvedValue(
			new Map( scenario.standing ? [ [ 456, { expiresAt: Date.now() + 3600000 } ] ] : [] )
		);
		vi.mocked( fetchSyncableSites ).mockResolvedValue( scenario.stillASite ? [ boughtSite ] : [] );
		const output = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

		try {
			if ( scenario.retry ) {
				vi.mocked( fetchSyncableSites ).mockRejectedValueOnce( new Error( 'Try later' ) );
				await runCommand( '/site', 'json' );
				expect( config.snapshots ).toHaveLength( 1 );
				expect( await getConnectedWpcomSitesForLocalSite( 'local' ) ).toEqual( [] );
			}
			await runCommand( '/site', 'json' );
		} finally {
			output.mockRestore();
		}

		expect( await getConnectedWpcomSitesForLocalSite( 'local' ) ).toEqual(
			scenario.connects
				? [ { ...boughtSite, localSiteId: 'local', syncSupport: 'already-connected' } ]
				: []
		);
	}
);
