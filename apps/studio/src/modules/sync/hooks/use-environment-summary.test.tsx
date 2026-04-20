import { configureStore } from '@reduxjs/toolkit';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { describe, it, expect, vi } from 'vitest';
import { environmentSummaryApi } from 'src/stores/sync/environment-summary-api';
import { useEnvironmentSummary } from './use-environment-summary';

const wpcomRequest = vi.fn();
vi.mock( 'src/lib/wpcom-request', () => ( {
	wpcomRequest: ( ...a: any[] ) => wpcomRequest( ...a ),
} ) );

function wrapper( { children }: { children: React.ReactNode } ) {
	const store = configureStore( {
		reducer: { [ environmentSummaryApi.reducerPath ]: environmentSummaryApi.reducer },
		middleware: ( g ) => g().concat( environmentSummaryApi.middleware ),
	} );
	return <Provider store={ store }>{ children }</Provider>;
}

describe( 'useEnvironmentSummary (remote)', () => {
	it( 'sums post and page counts from the API', async () => {
		wpcomRequest.mockImplementation( ( { path }: { path: string } ) => {
			if ( path.endsWith( '/post' ) ) {
				return Promise.resolve( { counts: { all: { publish: 12, draft: 2 } } } );
			}
			if ( path.endsWith( '/page' ) ) {
				return Promise.resolve( { counts: { all: { publish: 4 } } } );
			}
			return Promise.resolve( { counts: { all: {} } } );
		} );

		const { result } = renderHook(
			() => useEnvironmentSummary( { kind: 'remote', siteId: 1 } ),
			{ wrapper }
		);

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
		expect( result.current.counts.posts ).toBe( 14 );
		expect( result.current.counts.pages ).toBe( 4 );
	} );
} );
