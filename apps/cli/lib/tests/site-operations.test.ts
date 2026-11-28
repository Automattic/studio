import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { getConfigPath, readConfig, updateConfig } from '@studio/common/lib/config/store';
import { SITE_BUSY_ERROR_CODE } from '@studio/common/lib/site-operation';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { emitCliEvent } from 'cli/lib/daemon-client';
import {
	getLiveSiteOperation,
	withSiteStart,
	withSiteOperation,
	withSiteOperations,
} from '../site-operations';
import type { ConfigSite } from '@studio/common/lib/config/schema';

vi.mock( 'cli/lib/daemon-client', () => ( { emitCliEvent: vi.fn() } ) );
vi.mock( '@studio/common/lib/config/store', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/common/lib/config/store') >();
	return { ...actual, updateConfig: vi.fn( actual.updateConfig ) };
} );

const site: ConfigSite = {
	id: 'site-1',
	name: 'My WordPress Site',
	path: '/home/user/Studio/my-wordpress-site',
	port: 8888,
	phpVersion: DEFAULT_PHP_VERSION,
} as const;

const secondSite: ConfigSite = {
	...site,
	id: 'site-2',
	name: 'Second Site',
	path: '/home/user/Studio/second-site',
};

function writeSites( sites: ConfigSite[] ) {
	fs.writeFileSync( getConfigPath(), JSON.stringify( { version: 1, sites } ) );
}

async function storedSites() {
	return ( await readConfig() ).sites;
}

async function storedOperation() {
	return ( await storedSites() )[ 0 ].operation;
}

// A pid that is guaranteed not to be running, standing in for a client that
// crashed mid-operation.
const DEAD_PID = 0x7ffffffe;

const bootTime = Math.round( Date.now() - os.uptime() * 1000 );

let configDirectory: string;

beforeEach( () => {
	configDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-config-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDirectory );
	writeSites( [ site ] );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	fs.rmSync( configDirectory, { recursive: true, force: true } );
} );

describe( 'getLiveSiteOperation', () => {
	it( 'drops an operation whose owning process has died', () => {
		expect(
			getLiveSiteOperation( { ...site, operation: { pid: DEAD_PID, kind: 'delete', bootTime } } )
		).toBeUndefined();
	} );

	it( 'keeps an operation whose owning process is alive', () => {
		const operation = { pid: process.pid, kind: 'settings', bootTime } as const;
		expect( getLiveSiteOperation( { ...site, operation } ) ).toEqual( operation );
	} );

	it( 'drops an operation recorded before the machine last booted', () => {
		expect(
			getLiveSiteOperation( {
				...site,
				operation: { pid: process.pid, kind: 'export', bootTime: bootTime - 86_400_000 },
			} )
		).toBeUndefined();
	} );

	it( 'drops an operation from a build that recorded no boot time', () => {
		expect(
			getLiveSiteOperation( { ...site, operation: { pid: process.pid, kind: 'export' } } )
		).toBeUndefined();
	} );

	it( 'returns undefined for an idle site', () => {
		expect( getLiveSiteOperation( site ) ).toBeUndefined();
	} );
} );

describe( 'withSiteOperation', () => {
	it( 'records the operation while it runs and clears it afterwards', async () => {
		await withSiteOperation( site.path, 'settings', async () => {
			const operation = await storedOperation();
			expect( operation ).toMatchObject( { pid: process.pid, kind: 'settings' } );
			expect( getLiveSiteOperation( { ...site, operation } ) ).toEqual( operation );
		} );

		expect( await storedOperation() ).toBeUndefined();
	} );

	it( 'retries a release that fails to take the config lock', async () => {
		await withSiteOperation( site.path, 'export', async () => {
			vi.mocked( updateConfig ).mockRejectedValueOnce( new Error( 'Lock timed out' ) );
		} );

		expect( await storedOperation() ).toBeUndefined();
	} );

	it( 'releases the operation when the work throws', async () => {
		await expect(
			withSiteOperation( site.path, 'settings', async () => {
				throw new Error( 'settings blew up' );
			} )
		).rejects.toThrow( 'settings blew up' );

		expect( await storedOperation() ).toBeUndefined();
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
			const refused = withSiteOperation( site.path, 'stop', async () => undefined );
			await expect( refused ).rejects.toThrow( /already in progress/ );
			await expect( refused ).rejects.toMatchObject( { code: SITE_BUSY_ERROR_CODE } );
		} );
	} );

	it( "waits for another process's start instead of refusing a start", async () => {
		writeSites( [ { ...site, operation: { pid: process.ppid, kind: 'start', bootTime } } ] );
		setTimeout( () => writeSites( [ site ] ), 300 );

		const result = await withSiteOperation( site.path, 'start', async () => 'started' );

		expect( result ).toBe( 'started' );
		expect( await storedOperation() ).toBeUndefined();
	} );

	it( 'interrupts a start and waits for it to release the site before stopping', async () => {
		let enter!: () => void;
		const entered = new Promise< void >( ( resolve ) => {
			enter = resolve;
		} );
		const start = withSiteStart( site.path, async ( signal ) => {
			enter();
			await new Promise( ( _, reject ) =>
				signal.addEventListener( 'abort', () => reject( signal.reason ), { once: true } )
			);
		} );
		const cancelled = expect( start ).rejects.toThrow( 'Site start cancelled' );
		await entered;
		await withSiteOperation( site.path, 'stop', async () => {
			expect( ( await storedOperation() )?.kind ).toBe( 'stop' );
		} );
		await cancelled;
		expect( await storedOperation() ).toBeUndefined();
	} );

	it( 'names both operations in the error so the agent can act on it', async () => {
		await withSiteOperation( site.path, 'settings', async () => {
			await expect(
				withSiteOperation( site.path, 'start', async () => undefined )
			).rejects.toThrow( /site start.*settings change/ );
		} );
	} );

	it( 'reclaims an operation whose owning process is gone', async () => {
		writeSites( [ { ...site, operation: { pid: DEAD_PID, kind: 'delete', bootTime } } ] );

		const result = await withSiteOperation( site.path, 'start', async () => 'started' );

		expect( result ).toBe( 'started' );
		expect( await storedOperation() ).toBeUndefined();
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
		).rejects.toThrow( 'not added to Studio' );
	} );
} );

describe( 'withSiteOperations', () => {
	beforeEach( () => {
		writeSites( [ site, secondSite ] );
	} );

	it( 'acquires and releases every site', async () => {
		await withSiteOperations( [ site.id, secondSite.id ], 'delete', async () => {
			expect( ( await storedSites() ).map( ( item ) => item.operation ) ).toEqual( [
				expect.objectContaining( { pid: process.pid, kind: 'delete' } ),
				expect.objectContaining( { pid: process.pid, kind: 'delete' } ),
			] );
		} );

		expect( ( await storedSites() ).every( ( item ) => item.operation === undefined ) ).toBe(
			true
		);
	} );

	it( 'does not acquire any site when one is busy', async () => {
		const busy = { pid: process.pid, kind: 'settings', bootTime } as const;
		writeSites( [ site, { ...secondSite, operation: busy } ] );
		const work = vi.fn();

		await expect(
			withSiteOperations( [ site.id, secondSite.id ], 'delete', work )
		).rejects.toThrow( /already in progress/ );

		expect( ( await storedSites() ).map( ( item ) => item.operation ) ).toEqual( [
			undefined,
			busy,
		] );
		expect( work ).not.toHaveBeenCalled();
	} );

	it( 'does not acquire any site when one is missing', async () => {
		const work = vi.fn();

		await expect(
			withSiteOperations( [ site.id, 'missing-site' ], 'delete', work )
		).rejects.toThrow( 'Site not found' );

		expect( await storedOperation() ).toBeUndefined();
		expect( work ).not.toHaveBeenCalled();
	} );

	it( 'releases surviving sites after deleted records disappear', async () => {
		await withSiteOperations( [ site.id, secondSite.id ], 'delete', async () => {
			writeSites( ( await storedSites() ).filter( ( item ) => item.id !== site.id ) );
		} );

		expect( await storedSites() ).toEqual( [ expect.objectContaining( { id: secondSite.id } ) ] );
		expect( await storedOperation() ).toBeUndefined();
	} );
} );
