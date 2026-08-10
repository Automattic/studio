import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { LoggerError } from 'cli/logger';
import { getLiveSiteOperations, withSiteLock } from '../site-lock';

vi.mock( 'cli/lib/cli-config/core', () => ( {
	lockCliConfig: vi.fn(),
	unlockCliConfig: vi.fn(),
	readCliConfig: vi.fn(),
	saveCliConfig: vi.fn(),
} ) );
vi.mock( 'cli/lib/daemon-client', () => ( { emitCliEvent: vi.fn() } ) );
vi.mock( 'cli/lib/cli-config/sites', () => ( {
	getSiteByFolder: vi.fn( async ( folder: string ) => {
		if ( folder !== site.path ) {
			throw new LoggerError( 'Site not found' );
		}
		return site;
	} ),
} ) );

const site: SiteData = {
	id: 'site-1',
	name: 'My WordPress Site',
	path: '/home/user/Studio/my-wordpress-site',
	port: 8888,
	phpVersion: DEFAULT_PHP_VERSION,
} as const;

let mockConfig: Awaited< ReturnType< typeof readCliConfig > >;

function storedOperations() {
	return mockConfig.sites[ 0 ].operations;
}

// A pid that is guaranteed not to be running, standing in for a client that
// crashed while holding a lease.
const DEAD_PID = 0x7ffffffe;

beforeEach( () => {
	vi.clearAllMocks();
	mockConfig = { version: 1, sites: [ structuredClone( site ) ], snapshots: [] };
	vi.mocked( lockCliConfig ).mockResolvedValue( undefined );
	vi.mocked( unlockCliConfig ).mockResolvedValue( undefined );
	vi.mocked( readCliConfig ).mockImplementation( async () => structuredClone( mockConfig ) );
	vi.mocked( saveCliConfig ).mockImplementation( async ( config ) => {
		mockConfig = structuredClone( config );
	} );
} );

describe( 'getLiveSiteOperations', () => {
	it( 'drops leases whose owning process has died', () => {
		expect(
			getLiveSiteOperations( {
				...site,
				operations: [
					{ id: 'dead', pid: DEAD_PID, kind: 'import' },
					{ id: 'mine', pid: process.pid, kind: 'export' },
				],
			} )
		).toEqual( [ { id: 'mine', pid: process.pid, kind: 'export' } ] );
	} );

	it( 'returns an empty list for a site with no leases', () => {
		expect( getLiveSiteOperations( site ) ).toEqual( [] );
	} );
} );

describe( 'withSiteLock', () => {
	it( 'records the operation while it runs and clears it afterwards', async () => {
		await withSiteLock( site.path, 'import', async () => {
			expect( storedOperations() ).toEqual( [
				{
					id: expect.any( String ),
					pid: process.pid,
					kind: 'import',
				},
			] );
		} );

		expect( storedOperations() ).toBeUndefined();
	} );

	it( 'releases the lease when the operation throws', async () => {
		await expect(
			withSiteLock( site.path, 'pull', async () => {
				throw new Error( 'pull blew up' );
			} )
		).rejects.toThrow( 'pull blew up' );

		expect( storedOperations() ).toBeUndefined();
	} );

	it( 'refuses a second operation while one is held', async () => {
		await withSiteLock( site.path, 'import', async () => {
			await expect( withSiteLock( site.path, 'start', async () => 'started' ) ).rejects.toThrow(
				/already in progress/
			);
		} );
	} );

	it( 'refuses an operation while another holds the site', async () => {
		await withSiteLock( site.path, 'export', async () => {
			await expect( withSiteLock( site.path, 'delete', async () => undefined ) ).rejects.toThrow(
				/already in progress/
			);
		} );
	} );

	it( 'names both operations in the error so the agent can act on it', async () => {
		await withSiteLock( site.path, 'import', async () => {
			await expect( withSiteLock( site.path, 'start', async () => undefined ) ).rejects.toThrow(
				/site start.*import/
			);
		} );
	} );

	// Nothing is read-only: `export` and `push` both refresh the SQLite
	// integration inside wp-content before they read the tree, so two of them
	// on one site would delete and recreate the same files underneath.
	it( 'refuses a second export while one is already running', async () => {
		await withSiteLock( site.path, 'export', async () => {
			await expect( withSiteLock( site.path, 'push', async () => 'pushed' ) ).rejects.toThrow(
				/already in progress/
			);
		} );
	} );

	it( 'reclaims a lease whose owning process is gone', async () => {
		mockConfig.sites[ 0 ].operations = [ { id: 'dead', pid: DEAD_PID, kind: 'import' } ];

		const result = await withSiteLock( site.path, 'start', async () => 'started' );

		expect( result ).toBe( 'started' );
		expect( storedOperations() ).toBeUndefined();
	} );

	// Reusing SITE_EVENTS.UPDATED here made every acquire assert a running state
	// and clear the desktop renderer's loading flag mid-operation, which broke
	// stop/start badly enough to fail the startup performance metric.
	it( 'announces lease changes without claiming to know the running state', async () => {
		await withSiteLock( site.path, 'export', async () => undefined );

		const events = vi.mocked( emitCliEvent ).mock.calls.map( ( [ payload ] ) => payload.event );
		expect( events ).toEqual( [ SITE_EVENTS.OPERATIONS_CHANGED, SITE_EVENTS.OPERATIONS_CHANGED ] );
	} );

	it( 'does not lock a site that is not in the config', async () => {
		await expect( withSiteLock( '/no/such/site', 'start', async () => undefined ) ).rejects.toThrow(
			'Site not found'
		);
	} );
} );
