import { configureStore } from '@reduxjs/toolkit';
import { wordpressVersionsApi } from '../wordpress-versions-api';

jest.mock( '@reduxjs/toolkit/query/react', () => {
	const actual = jest.requireActual( '@reduxjs/toolkit/query/react' );
	return {
		...actual,
		fetchBaseQuery: () => async ( args: { url: string } | string ) => {
			const url = typeof args === 'string' ? args : args.url;
			const response = await global.fetch( url );
			return { data: await response.json() };
		},
	};
} );

const createTestStore = () => {
	return configureStore( {
		reducer: {
			[ wordpressVersionsApi.reducerPath ]: wordpressVersionsApi.reducer,
		},
		middleware: ( getDefaultMiddleware ) =>
			getDefaultMiddleware().concat( wordpressVersionsApi.middleware ),
	} );
};

describe( 'WordPress Versions API', () => {
	describe( 'fetchWordPressVersions', () => {
		it( 'should fetch both stable and development versions', async () => {
			( global.fetch as jest.Mock ).mockImplementation( ( url ) => {
				console.log( 'Mocked fetch called with URL:', url );
				if ( url.includes( 'channel=beta' ) ) {
					return Promise.resolve( {
						ok: true,
						json: () =>
							Promise.resolve( {
								offers: [
									{ version: '6.4.0', response: 'autoupdate' },
									{ version: '6.5.0-beta1', response: 'autoupdate' },
								],
							} ),
					} );
				}
				if ( url.includes( 'channel=development' ) ) {
					return Promise.resolve( {
						ok: true,
						json: () =>
							Promise.resolve( {
								offers: [
									{ version: '6.8-beta2-59979', response: 'development' },
									{ version: '6.8-beta2-59980', response: 'development' },
								],
							} ),
					} );
				}
				console.error( 'Unknown URL called:', url );
				return Promise.reject( new Error( 'Unknown URL' ) );
			} );
			const store = createTestStore();
			const result = await store.dispatch(
				wordpressVersionsApi.endpoints.getWordPressVersions.initiate( undefined )
			);

			// Verify both API calls were made with correct parameters
			expect( global.fetch ).toHaveBeenCalledTimes( 2 );
			expect( global.fetch ).toHaveBeenCalledWith(
				expect.stringMatching( /\?channel=beta&version=5\.9\.9$/ )
			);
			expect( global.fetch ).toHaveBeenCalledWith(
				expect.stringMatching( /\?channel=development$/ )
			);

			// Verify the result includes both stable and development versions
			expect( result.data ).toEqual( [
				{
					value: '6.8-beta2-59979',
					isBeta: true,
					isDevelopment: true,
					isLatest: false,
					label: 'nightly',
				},
				{
					value: '6.4.0',
					isBeta: false,
					isDevelopment: false,
					isLatest: true,
					label: '6.4.0 (latest)',
				},
				{
					value: '6.5.0-beta1',
					isBeta: true,
					isDevelopment: false,
					isLatest: false,
					label: '6.5.0-beta1',
				},
			] );
		} );
	} );
} );
