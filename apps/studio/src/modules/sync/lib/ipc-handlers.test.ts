import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock( '@studio/common/lib/shared-config', () => ( {
	getCurrentUserId: vi.fn(),
} ) );
vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	saveUserData: vi.fn(),
	lockAppdata: vi.fn(),
	unlockAppdata: vi.fn(),
} ) );

import { getCurrentUserId } from '@studio/common/lib/shared-config';
import { loadUserData, saveUserData } from 'src/storage/user-data';
import { updateConnectedSiteSlot } from './ipc-handlers';

describe( 'updateConnectedSiteSlot', () => {
	beforeEach( () => {
		vi.resetAllMocks();
		vi.mocked( getCurrentUserId ).mockResolvedValue( 1 );
	} );

	it( 'sets slotOverride on the matching connected site', async () => {
		vi.mocked( loadUserData ).mockResolvedValue( {
			connectedWpcomSites: {
				1: [ { id: 100, localSiteId: 'local-1', name: 'a' } ],
			},
		} as any );
		vi.mocked( saveUserData ).mockResolvedValue( undefined as any );

		await updateConnectedSiteSlot( {} as any, {
			localSiteId: 'local-1',
			siteId: 100,
			slotOverride: 'staging',
		} );

		const saved = vi.mocked( saveUserData ).mock.calls[ 0 ][ 0 ] as any;
		expect( saved.connectedWpcomSites[ 1 ][ 0 ].slotOverride ).toBe( 'staging' );
	} );

	it( 'clears slotOverride when passed null', async () => {
		vi.mocked( loadUserData ).mockResolvedValue( {
			connectedWpcomSites: {
				1: [
					{ id: 100, localSiteId: 'local-1', name: 'a', slotOverride: 'staging' },
				],
			},
		} as any );
		vi.mocked( saveUserData ).mockResolvedValue( undefined as any );

		await updateConnectedSiteSlot( {} as any, {
			localSiteId: 'local-1',
			siteId: 100,
			slotOverride: null,
		} );

		const saved = vi.mocked( saveUserData ).mock.calls[ 0 ][ 0 ] as any;
		expect( saved.connectedWpcomSites[ 1 ][ 0 ].slotOverride ).toBeUndefined();
	} );
} );
