import { configureStore } from '@reduxjs/toolkit';
import { vi } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { appVersionApi, selectIsNewVersion } from 'src/stores/app-version-api';

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn(),
} ) );

let mockForceShowWhatsNew = false;
vi.mock( 'src/constants', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('src/constants') >();
	return {
		...actual,
		get FORCE_SHOW_WHATS_NEW() {
			return mockForceShowWhatsNew;
		},
	};
} );

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
		mockForceShowWhatsNew = false;
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

		it( 'should return true for a first-time user (no stored version)', () => {
			const result = selectIsNewVersion( createMockQueryResult( undefined ), '1.2.0' );
			expect( result ).toBe( true );
		} );

		it( 'should return false when the stored version matches the current version', () => {
			const result = selectIsNewVersion( createMockQueryResult( '1.2.0' ), '1.2.0' );
			expect( result ).toBe( false );
		} );

		it( 'should not trigger on a patch bump when FORCE_SHOW_WHATS_NEW is false', () => {
			const result = selectIsNewVersion( createMockQueryResult( '1.2.0' ), '1.2.1' );
			expect( result ).toBe( false );
		} );

		it( 'should not trigger on a minor bump when FORCE_SHOW_WHATS_NEW is false', () => {
			const result = selectIsNewVersion( createMockQueryResult( '1.2.0' ), '1.3.0' );
			expect( result ).toBe( false );
		} );

		it( 'should not trigger on a major bump when FORCE_SHOW_WHATS_NEW is false', () => {
			const result = selectIsNewVersion( createMockQueryResult( '1.2.0' ), '2.0.0' );
			expect( result ).toBe( false );
		} );

		it( 'should return true when FORCE_SHOW_WHATS_NEW is true and the version changed', () => {
			mockForceShowWhatsNew = true;
			const result = selectIsNewVersion( createMockQueryResult( '2.0.0' ), '2.1.0' );
			expect( result ).toBe( true );
		} );

		it( 'should return false when FORCE_SHOW_WHATS_NEW is true but the version did not change', () => {
			mockForceShowWhatsNew = true;
			const result = selectIsNewVersion( createMockQueryResult( '3.0.0' ), '3.0.0' );
			expect( result ).toBe( false );
		} );
	} );
} );
