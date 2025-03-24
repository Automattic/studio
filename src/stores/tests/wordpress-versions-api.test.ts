import * as Sentry from '@sentry/electron/renderer';
import { store } from 'src/stores';
import { testActions, testReducer } from 'src/stores/tests/utils/test-reducer';
import {
	fetchWordPressVersions,
	wordpressVersionsSelectors,
} from 'src/stores/wordpress-versions-slice';

global.fetch = jest.fn();
jest.mock( '@sentry/electron/renderer', () => ( {
	captureException: jest.fn(),
} ) );

store.replaceReducer( testReducer );

describe( 'wordpress-versions-slice', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		store.dispatch( testActions.resetState() );
	} );
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
				return Promise.reject( new Error( 'Unknown URL' ) );
			} );

			const result = await store.dispatch( fetchWordPressVersions() );

			// Verify both API calls were made with correct parameters
			expect( global.fetch ).toHaveBeenCalledTimes( 2 );
			expect( global.fetch ).toHaveBeenCalledWith(
				expect.stringMatching( /\?channel=beta&version=5\.9\.9$/ )
			);
			expect( global.fetch ).toHaveBeenCalledWith(
				expect.stringMatching( /\?channel=development$/ )
			);

			// Verify the result includes both stable and development versions
			expect( result.payload ).toEqual( [
				{ value: '6.8-beta2-59979', isBeta: true, isDevelopment: true, label: 'nightly' },
				{ value: '6.4.0', isBeta: false, isDevelopment: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, isDevelopment: false, label: '6.5.0-beta1' },
			] );
		} );

		it( 'should handle development versions with correct labeling', async () => {
			( global.fetch as jest.Mock ).mockImplementation( ( url ) => {
				if ( url.includes( 'channel=beta' ) ) {
					return Promise.resolve( {
						ok: true,
						json: () => Promise.resolve( { offers: [] } ),
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

			const result = await store.dispatch( fetchWordPressVersions() );

			// Should only take the first development version
			expect( result.payload ).toEqual( [
				{ value: '6.8-alpha1-59979', isBeta: false, isDevelopment: true, label: 'nightly' },
			] );
		} );

		it( 'should handle non-OK API responses for both channels', async () => {
			( global.fetch as jest.Mock ).mockImplementation( () => Promise.resolve( { ok: false } ) );

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/rejected' );
			expect( result.payload ).toEqual( undefined );

			const state = store.getState();
			expect( state.wordpressVersions.versions ).toHaveLength( 0 );
			expect( state.wordpressVersions.status ).toBe( 'failed' );
			expect( state.wordpressVersions.error ).toBe( 'Failed to fetch WordPress versions' );
		} );

		it( 'should handle schema validation error for both channels', async () => {
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

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/rejected' );
			expect( Sentry.captureException ).toHaveBeenCalled();

			const state = store.getState();
			expect( state.wordpressVersions.versions ).toHaveLength( 0 );
			expect( state.wordpressVersions.status ).toBe( 'failed' );
			expect( state.wordpressVersions.error ).toBe(
				JSON.stringify(
					[
						{
							code: 'invalid_type',
							expected: 'array',
							received: 'undefined',
							path: [ 'offers' ],
							message: 'Required',
						},
					],
					null,
					2
				)
			);
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

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/fulfilled' );
			expect( result.payload ).toEqual( [
				{ value: '6.4.0', isBeta: false, isDevelopment: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, isDevelopment: false, label: '6.5.0-beta1' },
			] );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 2 );
			expect( versions[ 0 ] ).toEqual( {
				value: '6.4.0',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
			} );
			expect( versions[ 1 ] ).toEqual( {
				value: '6.5.0-beta1',
				isBeta: true,
				isDevelopment: false,
				label: '6.5.0-beta1',
			} );
			expect( state.wordpressVersions.status ).toBe( 'succeeded' );
			expect( state.wordpressVersions.error ).toBeNull();
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

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/fulfilled' );
			expect( result.payload ).toEqual( [] );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 0 );
			expect( state.wordpressVersions.status ).toBe( 'succeeded' );
		} );

		it( 'should handle API fetch error', async () => {
			( global.fetch as jest.Mock ).mockRejectedValue( new Error( 'Network error' ) );

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/rejected' );

			const state = store.getState();
			expect( state.wordpressVersions.versions ).toHaveLength( 0 );
			expect( state.wordpressVersions.status ).toBe( 'failed' );
			expect( state.wordpressVersions.error ).toBe( 'Network error' );
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

			const result = await store.dispatch( fetchWordPressVersions() );
			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/fulfilled' );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 2 );
			expect( versions[ 0 ] ).toEqual( {
				value: '6.4.0',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
			} );
			expect( versions[ 1 ] ).toEqual( {
				value: '6.5.0-beta1',
				isBeta: true,
				isDevelopment: false,
				label: '6.5.0-beta1',
			} );
			expect( state.wordpressVersions.status ).toBe( 'succeeded' );
			expect( state.wordpressVersions.error ).toBeNull();
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

			await store.dispatch( fetchWordPressVersions() );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 3 );
			expect( versions ).toEqual( [
				{ value: '6.4.0', isBeta: false, isDevelopment: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, isDevelopment: false, label: '6.5.0-beta1' },
				{ value: '6.5.0-RC1', isBeta: true, isDevelopment: false, label: '6.5.0-RC1' },
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

			await store.dispatch( fetchWordPressVersions() );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 2 );
			expect( versions ).toEqual( [
				{ value: '10.11.12', isBeta: false, isDevelopment: false, label: '10.11' },
				{ value: '6.5-dev', isBeta: false, isDevelopment: false, label: '6.5' },
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

			await store.dispatch( fetchWordPressVersions() );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 4 );
			expect( versions ).toEqual( [
				{ value: '6.7.2', isBeta: false, isDevelopment: false, label: '6.7.2' },
				{ value: '6.7.1', isBeta: false, isDevelopment: false, label: '6.7.1' },
				{ value: '6.6.2', isBeta: false, isDevelopment: false, label: '6.6' },
				{ value: '6.5.5', isBeta: false, isDevelopment: false, label: '6.5' },
			] );
		} );
	} );

	describe( 'selectors', () => {
		it( 'should select WordPress versions with name property', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: true,
				json: jest.fn().mockResolvedValueOnce( {
					offers: [
						{ version: '6.1.0', response: 'autoupdate' },
						{ version: '6.2.0', response: 'autoupdate' },
						{ version: '6.3.0', response: 'autoupdate' },
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.5.0-beta1', response: 'autoupdate' },
					],
				} ),
			} );

			await store.dispatch( fetchWordPressVersions() );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 5 );
			expect( versions ).toEqual( [
				{ value: '6.1.0', isBeta: false, isDevelopment: false, label: '6.1' },
				{ value: '6.2.0', isBeta: false, isDevelopment: false, label: '6.2' },
				{ value: '6.3.0', isBeta: false, isDevelopment: false, label: '6.3' },
				{ value: '6.4.0', isBeta: false, isDevelopment: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, isDevelopment: false, label: '6.5.0-beta1' },
			] );
		} );

		it( 'should select WordPress versions with latest', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: true,
				json: jest.fn().mockResolvedValueOnce( {
					offers: [
						{ version: '6.1.0', response: 'autoupdate' },
						{ version: '6.2.0', response: 'autoupdate' },
						{ version: '6.3.0', response: 'autoupdate' },
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.5.0-beta1', response: 'autoupdate' },
					],
				} ),
			} );

			await store.dispatch( fetchWordPressVersions() );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersionsWithLatest( state );

			expect( versions ).toEqual( [
				{ value: '6.1.0', isBeta: false, isDevelopment: false, label: '6.1 (latest)' },
				{ value: '6.2.0', isBeta: false, isDevelopment: false, label: '6.2' },
				{ value: '6.3.0', isBeta: false, isDevelopment: false, label: '6.3' },
				{ value: '6.4.0', isBeta: false, isDevelopment: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, isDevelopment: false, label: '6.5.0-beta1' },
			] );
		} );
	} );
} );
