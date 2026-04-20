import { configureStore } from '@reduxjs/toolkit';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { environmentSummaryApi } from './environment-summary-api';

const wpcomRequest = vi.fn();
vi.mock( 'src/lib/wpcom-request', () => ( {
	wpcomRequest: ( ...args: any[] ) => wpcomRequest( ...args ),
} ) );

describe( 'environmentSummaryApi', () => {
	beforeEach( () => {
		wpcomRequest.mockReset();
	} );

	it( 'fetches post counts for a given post type', async () => {
		wpcomRequest.mockResolvedValue( {
			counts: { all: { publish: 12, draft: 3 } },
		} );
		const store = configureStore( {
			reducer: { [ environmentSummaryApi.reducerPath ]: environmentSummaryApi.reducer },
			middleware: ( g ) => g().concat( environmentSummaryApi.middleware ),
		} );
		const result = await store.dispatch(
			environmentSummaryApi.endpoints.getPostCounts.initiate( {
				siteId: 123,
				postType: 'post',
			} )
		);
		expect( wpcomRequest ).toHaveBeenCalledWith( {
			path: '/sites/123/post-counts/post',
			apiNamespace: 'wpcom/v2',
			apiVersion: '1.2',
		} );
		expect( result.data?.counts.all.publish ).toBe( 12 );
	} );
} );
