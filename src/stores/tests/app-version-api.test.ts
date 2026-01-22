import { configureStore } from '@reduxjs/toolkit';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { FORCE_WHATS_NEW_WHEN_PATCH_CHANGED } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { appVersionApi, selectIsNewVersion } from 'src/stores/app-version-api';

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn(),
} ) );

const mockIpcApi = {
	getLastSeenVersion: vi.fn(),
	saveLastSeenVersion: vi.fn(),
};

vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( mockIpcApi );

const createTestStore = () => {
	return configureStore( {
		reducer: {
			[ appVersionApi.reducerPath ]: appVersionApi.reducer,
		},
		middleware: ( getDefaultMiddleware ) =>
			getDefaultMiddleware().concat( appVersionApi.middleware ),
	} );
};

describe( 'App Version API', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	describe( 'getLastSeenVersion', () => {
		it( 'should fetch the last seen version', async () => {
			mockIpcApi.getLastSeenVersion.mockResolvedValueOnce( '1.2.0' );

			const store = createTestStore();
			const result = await store.dispatch(
				appVersionApi.endpoints.getLastSeenVersion.initiate( undefined )
			);

			expect( mockIpcApi.getLastSeenVersion ).toHaveBeenCalledTimes( 1 );

			expect( result.data ).toBe( '1.2.0' );
		} );
	} );

	describe( 'saveLastSeenVersion', () => {
		it( 'should save the last seen version', async () => {
			mockIpcApi.saveLastSeenVersion.mockResolvedValueOnce( undefined );

			const versionToSave = '1.3.0';
			const store = createTestStore();
			const result = await store.dispatch(
				appVersionApi.endpoints.saveLastSeenVersion.initiate( versionToSave )
			);

			expect( mockIpcApi.saveLastSeenVersion ).toHaveBeenCalledTimes( 1 );
			expect( mockIpcApi.saveLastSeenVersion ).toHaveBeenCalledWith( versionToSave );

			expect( result.data ).toBe( versionToSave );
		} );
	} );

	describe( 'selectIsNewVersion', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const createMockQueryResult = ( data: string | undefined ): any => ( {
			data,
			isLoading: false,
			isSuccess: true,
			isError: false,
			error: undefined,
		} );

		it( 'should return true for a new major version', () => {
			const lastSeenVersion = '1.2.0';
			const currentVersion = '2.0.0';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( true );
		} );

		it( 'should return true for a new minor version', () => {
			const lastSeenVersion = '1.2.0';
			const currentVersion = '1.3.0';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( true );
		} );

		it( 'should return false for the same version', () => {
			const lastSeenVersion = '1.2.0';
			const currentVersion = '1.2.0';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( false );
		} );

		it( "should return true or false depending on whether force what's new is enabled for a new patch version", () => {
			const lastSeenVersion = '1.2.0';
			const currentVersion = '1.2.1';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( FORCE_WHATS_NEW_WHEN_PATCH_CHANGED );
		} );

		it( 'should return true when going from a stable version to a prerelease version', () => {
			const lastSeenVersion = '1.2.0';
			const currentVersion = '1.3.0-beta1';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( true );
		} );

		it( "It should return true or false depending on whether force what's new is enabled when going from a prerelease version to a stable version.", () => {
			const lastSeenVersion = '1.2.0-beta2';
			const currentVersion = '1.2.0';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( FORCE_WHATS_NEW_WHEN_PATCH_CHANGED );
		} );

		it( "Should return true or false depending on whether force what's new is enabled when going from a stable version to a prerelease version that increases only the patch.", () => {
			const lastSeenVersion = '1.2.0';
			const currentVersion = '1.2.1-beta1';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( FORCE_WHATS_NEW_WHEN_PATCH_CHANGED );
		} );

		it( 'should return true for a new prerelease version', () => {
			const lastSeenVersion = '1.2.0-beta1';
			const currentVersion = '1.2.0-beta2';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( true );
		} );

		it( 'should return true for undefined lastSeenVersion', () => {
			const lastSeenVersion = undefined;
			const currentVersion = '1.2.0';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( true );
		} );

		it( 'should return false for invalid version formats', () => {
			const lastSeenVersion = 'invalid';
			const currentVersion = 'also-invalid';

			const result = selectIsNewVersion( createMockQueryResult( lastSeenVersion ), currentVersion );

			expect( result ).toBe( false );
		} );
	} );
} );
