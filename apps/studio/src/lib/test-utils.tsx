import { configureStore } from '@reduxjs/toolkit';
import { rootReducer } from 'src/stores';
import { appVersionApi } from 'src/stores/app-version-api';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { wordpressVersionsApi } from 'src/stores/wordpress-versions-api';
import { wpcomApi, wpcomPublicApi } from 'src/stores/wpcom-api';

/**
 * Type helper for creating partial mocks in tests.
 * Use this to avoid TypeScript errors when mocking objects with many properties.
 *
 * @example
 * const mockWindow = createMock<BrowserWindow>({
 *   isMinimized: vi.fn(),
 *   restore: vi.fn(),
 * });
 */
export function createMock< T >( partial: Partial< T > ): T {
	return partial as T;
}

interface TestStoreOptions {
	preloadedState?: Parameters< typeof rootReducer >[ 0 ];
}

export function createTestStore( options: TestStoreOptions = {} ) {
	const store = configureStore( {
		reducer: rootReducer,
		preloadedState: options.preloadedState,
		middleware: ( getDefaultMiddleware ) =>
			getDefaultMiddleware( { immutableCheck: false, serializableCheck: false } )
				.concat( appVersionApi.middleware )
				.concat( installedAppsApi.middleware )
				.concat( wordpressVersionsApi.middleware )
				.concat( wpcomApi.middleware )
				.concat( wpcomPublicApi.middleware )
				.concat( certificateTrustApi.middleware ),
	} );

	return store;
}
