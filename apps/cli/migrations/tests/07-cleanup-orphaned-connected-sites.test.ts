import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
} from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { cleanupOrphanedConnectedSites } from '../07-cleanup-orphaned-connected-sites';
import type { SyncSite } from '@studio/common/types/sync';

vi.mock( '@studio/common/lib/shared-config', () => ( {
	lockSharedConfig: vi.fn(),
	readSharedConfig: vi.fn(),
	saveSharedConfig: vi.fn(),
	unlockSharedConfig: vi.fn(),
} ) );
vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn(),
} ) );

function connection( id: number, localSiteId: string ): SyncSite {
	return {
		id,
		localSiteId,
		name: `Site ${ id }`,
		url: `https://site-${ id }.example.com`,
		isStaging: false,
		isPressable: false,
		syncSupport: 'already-connected',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

describe( 'cleanupOrphanedConnectedSites', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readCliConfig, { partial: true } ).mockResolvedValue( {
			version: 1,
			sites: [
				{
					id: 'local-a',
					name: 'Local Site',
					path: '/local-a',
					port: 8881,
					phpVersion: '8.0',
				},
			],
			snapshots: [],
		} );
	} );

	it( 'removes orphaned connections across account buckets while preserving valid ones', async () => {
		const config = {
			version: 1 as const,
			connectedWpcomSites: {
				'7': [ connection( 1, 'local-a' ), connection( 2, 'deleted-site' ) ],
				'8': [ connection( 3, 'deleted-site' ) ],
			},
		};
		vi.mocked( readSharedConfig ).mockResolvedValue( config );

		await expect( cleanupOrphanedConnectedSites.needsToRun() ).resolves.toBe( true );
		await cleanupOrphanedConnectedSites.run();

		expect( lockSharedConfig ).toHaveBeenCalledOnce();
		expect( saveSharedConfig ).toHaveBeenCalledWith( config );
		expect( unlockSharedConfig ).toHaveBeenCalledOnce();
		expect( config.connectedWpcomSites ).toEqual( {
			'7': [ connection( 1, 'local-a' ) ],
		} );
		await expect( cleanupOrphanedConnectedSites.needsToRun() ).resolves.toBe( false );
	} );
} );
