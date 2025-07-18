import { configureStore } from '@reduxjs/toolkit';
import { render } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { rootReducer } from 'src/stores';
import { appVersionApi } from 'src/stores/app-version-api';
import { certificateTrustApi } from 'src/stores/certificate-trust-api';
import { installedAppsApi } from 'src/stores/installed-apps-api';
import { setProviderConstants } from 'src/stores/provider-constants-slice';
import { wordpressVersionsApi } from 'src/stores/wordpress-versions-api';
import { wpcomApi } from 'src/stores/wpcom-api';

interface TestStoreOptions {
	providerConstants?: {
		defaultPhpVersion?: string;
		defaultWordPressVersion?: string;
		allowedPhpVersions?: string[];
	};
	preloadedState?: any;
}

export function createTestStore( options: TestStoreOptions = {} ) {
	const store = configureStore( {
		reducer: rootReducer,
		preloadedState: options.preloadedState,
		middleware: ( getDefaultMiddleware ) =>
			getDefaultMiddleware()
				.concat( appVersionApi.middleware )
				.concat( installedAppsApi.middleware )
				.concat( wordpressVersionsApi.middleware )
				.concat( wpcomApi.middleware )
				.concat( certificateTrustApi.middleware ),
	} );

	// Set provider constants if provided
	if ( options.providerConstants ) {
		store.dispatch(
			setProviderConstants( {
				defaultPhpVersion: options.providerConstants.defaultPhpVersion || '',
				defaultWordPressVersion: options.providerConstants.defaultWordPressVersion || '',
				allowedPhpVersions: options.providerConstants.allowedPhpVersions || [],
			} )
		);
	}

	return store;
}

export function renderWithProvider( ui: React.ReactElement, options: TestStoreOptions = {} ) {
	const store = createTestStore( options );
	return {
		...render( <Provider store={ store }>{ ui }</Provider> ),
		store,
	};
}