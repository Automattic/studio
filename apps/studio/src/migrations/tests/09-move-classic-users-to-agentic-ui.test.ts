/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveClassicUsersToAgenticUi } from 'src/migrations/09-move-classic-users-to-agentic-ui';
import { recordAgenticUiMigration } from 'src/modules/user-settings/lib/ipc-handlers';
import { loadUserData, saveUserData } from 'src/storage/user-data';
import type { UserData } from 'src/storage/storage-types';

vi.mock( 'src/modules/user-settings/lib/ipc-handlers', () => ( {
	recordAgenticUiMigration: vi.fn(),
} ) );
vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: vi.fn(),
	saveUserData: vi.fn(),
	lockAppdata: vi.fn(),
	unlockAppdata: vi.fn(),
} ) );

let userData: UserData;

describe( 'moveClassicUsersToAgenticUi', () => {
	beforeEach( () => {
		userData = {
			version: 1,
			siteMetadata: {},
			betaFeatures: { enableAgenticUi: false, someFutureFeature: true },
		};
		vi.mocked( loadUserData ).mockImplementation( async () => structuredClone( userData ) );
		vi.mocked( saveUserData ).mockImplementation( async ( data ) => {
			userData = data;
		} );
	} );

	it( 'moves a classic user over once, keeping their other beta features', async () => {
		await expect( moveClassicUsersToAgenticUi.needsToRun() ).resolves.toBe( true );

		await moveClassicUsersToAgenticUi.run();

		expect( recordAgenticUiMigration ).toHaveBeenCalled();
		expect( userData.betaFeatures ).toEqual( { someFutureFeature: true } );
		await expect( moveClassicUsersToAgenticUi.needsToRun() ).resolves.toBe( false );
	} );
} );
