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
import { getLiveSiteOperation, withSiteOperation } from '../site-operations';

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

function storedOperation() {
	return mockConfig.sites[ 0 ].operation;
}

// A pid that is guaranteed not to be running, standing in for a client that
// crashed mid-operation.
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

describe( 'getLiveSiteOperation', () => {
	it( 'drops an operation whose owning process has died', () => {
		expect(
			getLiveSiteOperation( { ...site, operation: { pid: DEAD_PID, kind: 'delete' } } )
		).toBeUndefined();
	} );

	it( 'keeps an operation whose owning process is alive', () => {
		expect(
			getLiveSiteOperation( { ...site, operation: { pid: process.pid, kind: 'settings' } } )
		).toEqual( { pid: process.pid, kind: 'settings' } );
	} );

	it( 'returns undefined for an idle site', () => {
		expect( getLiveSiteOperation( site ) ).toBeUndefined();
	} );
} );

describe( 'withSiteOperation', () => {
	it( 'records the operation while it runs and clears it afterwards', async () => {
		await withSiteOperation( site.path, 'settings', async () => {
			expect( storedOperation() ).toEqual( { pid: process.pid, kind: 'settings' } );
		} );

		expect( storedOperation() ).toBeUndefined();
	} );

	it( 'releases the operation when the work throws', async () => {
		await expect(
			withSiteOperation( site.path, 'settings', async () => {
				throw new Error( 'settings blew up' );
			} )
		).rejects.toThrow( 'settings blew up' );

		expect( storedOperation() ).toBeUndefined();
	} );

	it( 'refuses a second operation while one is held', async () => {
		await withSiteOperation( site.path, 'settings', async () => {
			await expect(
				withSiteOperation( site.path, 'start', async () => 'started' )
			).rejects.toThrow( /already in progress/ );
		} );
	} );

	it( 'refuses an operation while another holds the site', async () => {
		await withSiteOperation( site.path, 'delete', async () => {
			await expect( withSiteOperation( site.path, 'stop', async () => undefined ) ).rejects.toThrow(
				/already in progress/
			);
		} );
	} );

	it( 'names both operations in the error so the agent can act on it', async () => {
		await withSiteOperation( site.path, 'settings', async () => {
			await expect(
				withSiteOperation( site.path, 'start', async () => undefined )
			).rejects.toThrow( /site start.*settings change/ );
		} );
	} );

	it( 'reclaims an operation whose owning process is gone', async () => {
		mockConfig.sites[ 0 ].operation = { pid: DEAD_PID, kind: 'delete' };

		const result = await withSiteOperation( site.path, 'start', async () => 'started' );

		expect( result ).toBe( 'started' );
		expect( storedOperation() ).toBeUndefined();
	} );

	// Reusing SITE_EVENTS.UPDATED here made every acquire assert a running state
	// and clear the desktop renderer's loading flag mid-operation, which broke
	// stop/start badly enough to fail the startup performance metric.
	it( 'announces operation changes without claiming to know the running state', async () => {
		await withSiteOperation( site.path, 'settings', async () => undefined );

		const events = vi.mocked( emitCliEvent ).mock.calls.map( ( [ payload ] ) => payload.event );
		expect( events ).toEqual( [ SITE_EVENTS.OPERATIONS_CHANGED, SITE_EVENTS.OPERATIONS_CHANGED ] );
	} );

	it( 'does not lock a site that is not in the config', async () => {
		await expect(
			withSiteOperation( '/no/such/site', 'start', async () => undefined )
		).rejects.toThrow( 'Site not found' );
	} );
} );
