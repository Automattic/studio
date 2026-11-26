import os from 'node:os';
import { afterEach, vi } from 'vitest';
import {
	assertSiteCapacity,
	assertSiteCountLimit,
	assertStorageAvailable,
} from 'cli/lib/site-capacity';
import { SITE_PROCESS_PREFIX } from 'cli/lib/types/process-manager-ipc';

const running = ( count: number ) =>
	Array.from( { length: count }, ( _, index ) => ( {
		name: `${ SITE_PROCESS_PREFIX }${ index }`,
		status: 'online',
	} ) );

afterEach( () => vi.unstubAllEnvs() );

describe( 'site capacity', () => {
	it( 'stops a start at the host’s running-site limit', () => {
		vi.stubEnv( 'STUDIO_MAX_RUNNING_SITES', '2' );
		expect( () => assertSiteCapacity( running( 1 ) ) ).not.toThrow();
		expect( () => assertSiteCapacity( running( 2 ) ) ).toThrow( 'CAPACITY_LIMIT_REACHED' );
	} );

	it( 'refuses a new site at the host’s site limit, and has none by default', () => {
		const sites = [ {}, {} ];
		expect( () => assertSiteCountLimit( sites ) ).not.toThrow();
		vi.stubEnv( 'STUDIO_MAX_SITES', '2' );
		expect( () => assertSiteCountLimit( sites ) ).toThrow( 'Your plan allows 2 sites' );
		expect( () => assertSiteCountLimit( sites.slice( 1 ) ) ).not.toThrow();
	} );

	it( 'refuses what won’t fit in the host’s storage limit, and has none by default', async () => {
		const gigabyte = 1024 ** 3;
		await expect( assertStorageAvailable( () => gigabyte, os.tmpdir() ) ).resolves.toBeUndefined();
		// This computer's disk already holds more than 1 GB.
		vi.stubEnv( 'STUDIO_MAX_STORAGE_GB', '1' );
		await expect( assertStorageAvailable( () => gigabyte, os.tmpdir() ) ).rejects.toThrow(
			'This needs about 1.0 GB of storage'
		);
		vi.stubEnv( 'STUDIO_MAX_STORAGE_GB', '1000000' );
		await expect( assertStorageAvailable( () => gigabyte, os.tmpdir() ) ).resolves.toBeUndefined();
	} );
} );
