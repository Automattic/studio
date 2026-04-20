import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi } from 'vitest';
import { environmentSummaryApi } from 'src/stores/sync/environment-summary-api';
import { EnvironmentColumn } from './environment-column';

vi.mock( 'src/lib/wpcom-request', () => ( {
	wpcomRequest: vi.fn().mockResolvedValue( { counts: { all: {} } } ),
} ) );

const store = configureStore( {
	reducer: { [ environmentSummaryApi.reducerPath ]: environmentSummaryApi.reducer },
	middleware: ( g ) => g().concat( environmentSummaryApi.middleware ),
} );

describe( 'EnvironmentColumn', () => {
	it( 'renders name, label, and URL for a remote production column', () => {
		render(
			<Provider store={ store }>
				<EnvironmentColumn
					kind="remote"
					label="Production"
					site={ {
						id: 1,
						localSiteId: 'local',
						name: 'My Prod',
						url: 'https://example.com',
						isStaging: false,
						isPressable: false,
						environmentType: 'production',
						syncSupport: 'syncable',
						lastPullTimestamp: null,
						lastPushTimestamp: null,
					} }
				/>
			</Provider>
		);
		expect( screen.getByText( 'Production' ) ).toBeInTheDocument();
		expect( screen.getByText( 'My Prod' ) ).toBeInTheDocument();
		expect( screen.getByText( 'example.com' ) ).toBeInTheDocument();
	} );
} );
