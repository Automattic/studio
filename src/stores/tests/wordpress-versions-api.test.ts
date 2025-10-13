import { configureStore } from '@reduxjs/toolkit';
import { ZodError } from 'zod';
import { store } from '..';
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
				wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
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
					value: 'latest',
					isBeta: false,
					isDevelopment: false,
					label: '6.4',
				},
				{
					value: '6.8-beta2-59979',
					isBeta: true,
					isDevelopment: true,
					label: 'nightly',
				},
				{
					value: '6.4.0',
					isBeta: false,
					isDevelopment: false,
					label: '6.4',
				},
				{
					value: '6.5.0-beta1',
					isBeta: true,
					isDevelopment: false,
					label: '6.5.0-beta1',
				},
			] );
		} );
	} );

	it( 'should handle development versions with correct labeling', async () => {
		( global.fetch as jest.Mock ).mockImplementation( ( url ) => {
			if ( url.includes( 'channel=beta' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () =>
						Promise.resolve( {
							offers: [],
						} ),
				} );
			}
			if ( url.includes( 'channel=development' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () =>
						Promise.resolve( {
							offers: [
								{ version: '6.8-alpha1-59979', response: 'development' },
								{ version: '6.8-beta2-59980', response: 'development' },
								{ version: '6.8-rc1-59981', response: 'development' },
							],
						} ),
				} );
			}
			return Promise.reject( new Error( 'Unknown URL' ) );
		} );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);

		// Should only take the first development version
		expect( result.data ).toEqual( [
			{
				value: '6.8-alpha1-59979',
				isBeta: false,
				isDevelopment: true,
				label: 'nightly',
			},
		] );
	} );

	it( 'should handle schema validation error for both channels', async () => {
		const consoleSpy = jest.spyOn( console, 'error' ).mockImplementation( () => {} );

		( global.fetch as jest.Mock ).mockImplementation( () =>
			Promise.resolve( {
				ok: true,
				json: () =>
					Promise.resolve( {
						// Missing 'offers' field to trigger schema validation error
						something_else: [],
					} ),
			} )
		);

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);

		expect( result.isError ).toBe( true );
		expect( result.error ).toBeDefined();
		const error = result.error as ZodError;
		expect( error.name ).toBe( 'ZodError' );
		expect( JSON.parse( error.message ) ).toEqual( [
			{
				code: 'invalid_type',
				expected: 'array',
				message: 'Required',
				path: [ 'offers' ],
				received: 'undefined',
			},
		] );

		expect( result.data ).toBeUndefined();

		consoleSpy.mockRestore();
	} );

	it( 'should update versions when API call is successful', async () => {
		( global.fetch as jest.Mock ).mockImplementation( ( url ) => {
			if ( url.includes( 'channel=beta' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () =>
						Promise.resolve( {
							offers: [
								{ version: '6.4.0', response: 'autoupdate' },
								{ version: '6.5.0-beta1', response: 'autoupdate' },
								{ version: '6.3.0', response: 'upgrade' }, // Should be filtered out
							],
						} ),
				} );
			}
			if ( url.includes( 'channel=development' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () => Promise.resolve( { offers: [] } ),
				} );
			}
			return Promise.reject( new Error( 'Unknown URL' ) );
		} );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);

		expect( result.isSuccess ).toBe( true );
		expect( result.isError ).toBe( false );
		expect( result.data ).toEqual( [
			{
				value: 'latest',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
			},
			{
				value: '6.4.0',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
			},
			{
				value: '6.5.0-beta1',
				isBeta: true,
				isDevelopment: false,
				label: '6.5.0-beta1',
			},
		] );
	} );

	it( 'should handle API response with no autoupdate offers', async () => {
		( global.fetch as jest.Mock ).mockImplementation( ( url ) => {
			if ( url.includes( 'channel=beta' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () =>
						Promise.resolve( {
							offers: [
								{ version: '6.3.0', response: 'upgrade' },
								{ version: '6.2.0', response: 'upgrade' },
							],
						} ),
				} );
			}
			if ( url.includes( 'channel=development' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () => Promise.resolve( { offers: [] } ),
				} );
			}
			return Promise.reject( new Error( 'Unknown URL' ) );
		} );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);

		expect( result.isSuccess ).toBe( true );
		expect( result.isError ).toBe( false );
		expect( result.data ).toEqual( [] );
	} );

	it( 'should handle API fetch error', async () => {
		const consoleSpy = jest.spyOn( console, 'error' ).mockImplementation( () => {} );

		( global.fetch as jest.Mock ).mockRejectedValue( new Error( 'Network error' ) );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);
		expect( result.isError ).toBe( true );
		expect( result.error ).toBeDefined();
		if ( 'message' in result.error! ) {
			expect( result.error.message ).toBe( 'Network error' );
		}

		expect( result.data ).toBeUndefined();

		consoleSpy.mockRestore();
	} );

	it( 'should gracefully handle schema validation errors for individual offers', async () => {
		( global.fetch as jest.Mock ).mockImplementation( ( url ) => {
			if ( url.includes( 'channel=beta' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () =>
						Promise.resolve( {
							offers: [
								{ version: '6.4.0', response: 'autoupdate' },
								{ version: '6.5.0-beta1', response: 'autoupdate' },
								{ version: '6.5.0-RC1', response: 10 }, // Invalid response type
							],
						} ),
				} );
			}
			if ( url.includes( 'channel=development' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () => Promise.resolve( { offers: [] } ),
				} );
			}
			return Promise.reject( new Error( 'Unknown URL' ) );
		} );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);
		const versions = result.data || [];

		expect( result.isSuccess ).toBe( true );
		expect( result.isError ).toBe( false );

		expect( versions ).toHaveLength( 3 );
		expect( versions[ 0 ] ).toEqual( {
			value: 'latest',
			isBeta: false,
			isDevelopment: false,
			label: '6.4',
		} );
		expect( versions[ 1 ] ).toEqual( {
			value: '6.4.0',
			isBeta: false,
			isDevelopment: false,
			label: '6.4',
		} );
		expect( versions[ 2 ] ).toEqual( {
			value: '6.5.0-beta1',
			isBeta: true,
			isDevelopment: false,
			label: '6.5.0-beta1',
		} );
	} );

	it( 'should correctly identify beta and RC versions and use full version for name', async () => {
		( global.fetch as jest.Mock ).mockResolvedValueOnce( {
			ok: true,
			json: jest.fn().mockResolvedValueOnce( {
				offers: [
					{ version: '6.4.0', response: 'autoupdate' },
					{ version: '6.5.0-beta1', response: 'autoupdate' },
					{ version: '6.5.0-RC1', response: 'autoupdate' },
				],
			} ),
		} );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);

		const versions = result.data || [];

		expect( versions ).toHaveLength( 4 );
		expect( versions ).toEqual( [
			{
				value: 'latest',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
			},
			{
				value: '6.4.0',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
			},
			{
				value: '6.5.0-beta1',
				isBeta: true,
				isDevelopment: false,
				label: '6.5.0-beta1',
			},
			{
				value: '6.5.0-RC1',
				isBeta: true,
				isDevelopment: false,
				label: '6.5.0-RC1',
			},
		] );
	} );

	it( 'should handle unusual version formats', async () => {
		( global.fetch as jest.Mock ).mockResolvedValueOnce( {
			ok: true,
			json: jest.fn().mockResolvedValueOnce( {
				offers: [
					{ version: '10.11.12', response: 'autoupdate' },
					{ version: '6.5-dev', response: 'autoupdate' },
				],
			} ),
		} );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);
		const versions = result.data || [];

		expect( versions ).toHaveLength( 3 );
		expect( versions ).toEqual( [
			{
				value: 'latest',
				isBeta: false,
				isDevelopment: false,
				label: '10.11',
			},
			{
				value: '10.11.12',
				isBeta: false,
				isDevelopment: false,
				label: '10.11',
			},
			{
				value: '6.5-dev',
				isBeta: false,
				isDevelopment: false,
				label: '6.5',
			},
		] );
	} );

	it( 'should handle multiple patch versions of the same minor', async () => {
		( global.fetch as jest.Mock ).mockResolvedValueOnce( {
			ok: true,
			json: jest.fn().mockResolvedValueOnce( {
				offers: [
					{
						response: 'upgrade',
						version: '6.7.2',
					},
					{
						response: 'autoupdate',
						version: '6.7.2',
					},
					{
						response: 'autoupdate',
						version: '6.7.1',
					},
					{
						response: 'autoupdate',
						version: '6.6.2',
					},
					{
						response: 'autoupdate',
						version: '6.5.5',
					},
				],
				translations: [],
			} ),
		} );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);

		const versions = result.data || [];

		expect( versions ).toHaveLength( 5 );
		expect( versions ).toEqual( [
			{
				value: 'latest',
				isBeta: false,
				isDevelopment: false,
				label: '6.7.2',
			},
			{
				value: '6.7.2',
				isBeta: false,
				isDevelopment: false,
				label: '6.7.2',
			},
			{ value: '6.7.1', isBeta: false, isDevelopment: false, label: '6.7.1' },
			{ value: '6.6.2', isBeta: false, isDevelopment: false, label: '6.6' },
			{ value: '6.5.5', isBeta: false, isDevelopment: false, label: '6.5' },
		] );
	} );

	describe( 'selectors', () => {
		it( 'should select WordPress versions with name property', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: true,
				json: jest.fn().mockResolvedValueOnce( {
					offers: [
						{ version: '6.5.0-beta1', response: 'autoupdate' },
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.3.0', response: 'autoupdate' },
						{ version: '6.2.0', response: 'autoupdate' },
						{ version: '6.1.0', response: 'autoupdate' },
					],
				} ),
			} );

			const result = await store.dispatch(
				wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
			);
			const versions = result.data || [];

			expect( versions ).toHaveLength( 6 );
			expect( versions ).toEqual( [
				{
					value: 'latest',
					isBeta: false,
					isDevelopment: false,
					label: '6.4',
				},
				{
					value: '6.5.0-beta1',
					isBeta: true,
					isDevelopment: false,
					label: '6.5.0-beta1',
				},
				{
					value: '6.4.0',
					isBeta: false,
					isDevelopment: false,
					label: '6.4',
				},
				{ value: '6.3.0', isBeta: false, isDevelopment: false, label: '6.3' },
				{ value: '6.2.0', isBeta: false, isDevelopment: false, label: '6.2' },
				{
					value: '6.1.0',
					isBeta: false,
					isDevelopment: false,
					label: '6.1',
				},
			] );
		} );

		it( 'should select WordPress versions with latest', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: true,
				json: jest.fn().mockResolvedValueOnce( {
					offers: [
						{ version: '6.5.0-beta1', response: 'autoupdate' },
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.3.0', response: 'autoupdate' },
						{ version: '6.2.0', response: 'autoupdate' },
						{ version: '6.1.0', response: 'autoupdate' },
					],
				} ),
			} );

			const store = createTestStore();
			const result = await store.dispatch(
				wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
			);
			const versions = result.data || [];

			expect( versions ).toEqual( [
				{
					value: 'latest',
					isBeta: false,
					isDevelopment: false,
					label: '6.4',
				},
				{
					value: '6.5.0-beta1',
					isBeta: true,
					isDevelopment: false,
					label: '6.5.0-beta1',
				},
				{
					value: '6.4.0',
					isBeta: false,
					isDevelopment: false,
					label: '6.4',
				},
				{ value: '6.3.0', isBeta: false, isDevelopment: false, label: '6.3' },
				{ value: '6.2.0', isBeta: false, isDevelopment: false, label: '6.2' },
				{ value: '6.1.0', isBeta: false, isDevelopment: false, label: '6.1' },
			] );
		} );
	} );
} );
