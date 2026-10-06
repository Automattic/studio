import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { removeSiteRuntime } from '../09-remove-site-runtime';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/cli-config/core', () => ( {
	lockCliConfig: vi.fn(),
	readCliConfig: vi.fn(),
	saveCliConfig: vi.fn(),
	unlockCliConfig: vi.fn(),
} ) );

function site( overrides: Partial< SiteData > = {} ): SiteData {
	return {
		id: 'site-a',
		name: 'Site A',
		path: '/site-a',
		port: 8881,
		phpVersion: '8.4',
		...overrides,
	};
}

function mockSites( sites: SiteData[] ) {
	vi.mocked( readCliConfig ).mockImplementation( async () => ( {
		version: 1,
		sites: structuredClone( sites ),
		snapshots: [],
	} ) );
}

function savedSites(): SiteData[] {
	return vi.mocked( saveCliConfig ).mock.calls[ 0 ][ 0 ].sites;
}

describe( 'removeSiteRuntime', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'does not need to run when no site stores a runtime', async () => {
		mockSites( [ site() ] );
		await expect( removeSiteRuntime.needsToRun() ).resolves.toBe( false );
	} );

	it.each( [ 'playground', 'native-php' ] as const )(
		'needs to run when a site stores the %s runtime',
		async ( runtime ) => {
			mockSites( [ site(), site( { id: 'site-b', runtime } ) ] );
			await expect( removeSiteRuntime.needsToRun() ).resolves.toBe( true );
		}
	);

	it( 'moves Sandbox sites to native PHP and clamps their PHP version', async () => {
		mockSites( [ site( { runtime: 'playground', phpVersion: '7.4' } ) ] );

		await removeSiteRuntime.run();

		const [ migrated ] = savedSites();
		expect( migrated ).not.toHaveProperty( 'runtime' );
		expect( migrated.phpVersion ).toBe( '8.2' );
	} );

	it( 'keeps a Sandbox PHP version it cannot map to a native one', async () => {
		mockSites( [ site( { runtime: 'playground', phpVersion: 'latest' } ) ] );

		await removeSiteRuntime.run();

		expect( savedSites()[ 0 ].phpVersion ).toBe( 'latest' );
	} );

	it( 'drops the runtime from native sites without touching other settings', async () => {
		mockSites( [
			site( {
				runtime: 'native-php',
				phpVersion: '8.0',
				fileAccess: 'all-files',
				customDomain: 'site-a.wp.local',
			} ),
		] );

		await removeSiteRuntime.run();

		expect( savedSites() ).toEqual( [
			site( { phpVersion: '8.0', fileAccess: 'all-files', customDomain: 'site-a.wp.local' } ),
		] );
	} );

	it( 'releases the config lock when saving fails', async () => {
		mockSites( [ site( { runtime: 'playground' } ) ] );
		vi.mocked( saveCliConfig ).mockRejectedValueOnce( new Error( 'disk full' ) );

		await expect( removeSiteRuntime.run() ).rejects.toThrow( 'disk full' );
		expect( lockCliConfig ).toHaveBeenCalledOnce();
		expect( unlockCliConfig ).toHaveBeenCalledOnce();
	} );
} );
