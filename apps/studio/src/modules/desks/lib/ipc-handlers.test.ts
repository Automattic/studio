import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSiteDeskConfig, saveSiteDeskConfig } from 'src/modules/desks/lib/ipc-handlers';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { DeskConfig } from '@studio/common/types/desk';
import type { IpcMainInvokeEvent } from 'electron';

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	lockAppdata: vi.fn(),
	saveUserData: vi.fn(),
	unlockAppdata: vi.fn(),
} ) );

const event = {} as IpcMainInvokeEvent;

const deskConfig: DeskConfig = {
	version: 1,
	updatedAt: '2026-05-09T00:00:00.000Z',
	widgets: [],
};

describe( 'desks IPC handlers', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'loads a site desk config by site id', async () => {
		vi.mocked( loadUserData ).mockResolvedValue( {
			version: 1,
			siteMetadata: {},
			desks: {
				sites: {
					'site-1': deskConfig,
				},
			},
		} );

		await expect( getSiteDeskConfig( event, 'site-1' ) ).resolves.toBe( deskConfig );
	} );

	it( 'saves a site desk config without replacing other desks', async () => {
		const existingSiteDesk: DeskConfig = {
			...deskConfig,
			updatedAt: '2026-05-08T00:00:00.000Z',
		};
		vi.mocked( loadUserData ).mockResolvedValue( {
			version: 1,
			siteMetadata: {},
			desks: {
				user: existingSiteDesk,
				sites: {
					'site-1': existingSiteDesk,
				},
			},
		} );

		await saveSiteDeskConfig( event, 'site-2', deskConfig );

		expect( vi.mocked( lockAppdata ).mock.invocationCallOrder[ 0 ] ).toBeLessThan(
			vi.mocked( saveUserData ).mock.invocationCallOrder[ 0 ]
		);
		expect( saveUserData ).toHaveBeenCalledWith( {
			version: 1,
			siteMetadata: {},
			desks: {
				user: existingSiteDesk,
				sites: {
					'site-1': existingSiteDesk,
					'site-2': deskConfig,
				},
			},
		} );
		expect( unlockAppdata ).toHaveBeenCalled();
	} );
} );
