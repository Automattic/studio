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
		it( 'should update versions when API call is successful', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: true,
				json: jest.fn().mockResolvedValueOnce( {
					offers: [
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.5.0-beta1', response: 'autoupdate' },
						{ version: '6.3.0', response: 'upgrade' }, // Should be filtered out
					],
				} ),
			} );

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/fulfilled' );
			expect( result.payload ).toEqual( [
				{ value: '6.4.0', isBeta: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, label: '6.5.0-beta1' },
			] );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 2 );
			expect( versions[ 0 ] ).toEqual( { value: '6.4.0', isBeta: false, label: '6.4' } );
			expect( versions[ 1 ] ).toEqual( {
				value: '6.5.0-beta1',
				isBeta: true,
				label: '6.5.0-beta1',
			} );
			expect( state.wordpressVersions.status ).toBe( 'succeeded' );
			expect( state.wordpressVersions.error ).toBeNull();
		} );

		it( 'should handle API response with no autoupdate offers', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: true,
				json: jest.fn().mockResolvedValueOnce( {
					offers: [
						{ version: '6.3.0', response: 'upgrade' },
						{ version: '6.2.0', response: 'upgrade' },
					],
				} ),
			} );

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/fulfilled' );
			expect( result.payload ).toEqual( [] );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 0 );
			expect( state.wordpressVersions.status ).toBe( 'succeeded' );
		} );

		it( 'should handle non-OK API response', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: false,
			} );

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/rejected' );
			expect( result.payload ).toEqual( undefined );

			const state = store.getState();
			expect( state.wordpressVersions.versions ).toHaveLength( 0 );
			expect( state.wordpressVersions.status ).toBe( 'failed' );
			expect( state.wordpressVersions.error ).toBe( 'Failed to fetch WordPress versions' );
		} );

		it( 'should handle API fetch error', async () => {
			( global.fetch as jest.Mock ).mockRejectedValueOnce( new Error( 'Network error' ) );

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/rejected' );

			const state = store.getState();
			expect( state.wordpressVersions.versions ).toHaveLength( 0 );
			expect( state.wordpressVersions.status ).toBe( 'failed' );
			expect( state.wordpressVersions.error ).toBe( 'Network error' );
		} );

		it( 'should handle schema validation error', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: true,
				json: jest.fn().mockResolvedValueOnce( {
					// Missing 'offers' field to trigger schema validation error
					something_else: [],
				} ),
			} );

			const result = await store.dispatch( fetchWordPressVersions() );

			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/rejected' );
			expect( result.payload ).toEqual( undefined );
			expect( Sentry.captureException ).toHaveBeenCalled();

			const state = store.getState();
			expect( state.wordpressVersions.versions ).toHaveLength( 0 );
			expect( state.wordpressVersions.status ).toBe( 'failed' );
			expect( state.wordpressVersions.error ).toContain( 'invalid_type' );
		} );

		it( 'should gracefully handle schema validation errors for individual offers', async () => {
			( global.fetch as jest.Mock ).mockResolvedValueOnce( {
				ok: true,
				json: jest.fn().mockResolvedValueOnce( {
					offers: [
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.5.0-beta1', response: 'autoupdate' },
						{ version: '6.5.0-RC1', response: 10 },
					],
				} ),
			} );

			const result = await store.dispatch( fetchWordPressVersions() );
			expect( result.type ).toBe( 'wordpressVersions/fetchWordPressVersions/fulfilled' );

			const state = store.getState();
			const versions = wordpressVersionsSelectors.selectWordPressVersions( state );

			expect( versions ).toHaveLength( 2 );
			expect( versions[ 0 ] ).toEqual( { value: '6.4.0', isBeta: false, label: '6.4' } );
			expect( versions[ 1 ] ).toEqual( {
				value: '6.5.0-beta1',
				isBeta: true,
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
				{ value: '6.4.0', isBeta: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, label: '6.5.0-beta1' },
				{ value: '6.5.0-RC1', isBeta: true, label: '6.5.0-RC1' },
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
				{ value: '10.11.12', isBeta: false, label: '10.11' },
				{ value: '6.5-dev', isBeta: false, label: '6.5' },
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
				{ value: '6.7.2', isBeta: false, label: '6.7.2' },
				{ value: '6.7.1', isBeta: false, label: '6.7.1' },
				{ value: '6.6.2', isBeta: false, label: '6.6' },
				{ value: '6.5.5', isBeta: false, label: '6.5' },
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
				{ value: '6.1.0', isBeta: false, label: '6.1' },
				{ value: '6.2.0', isBeta: false, label: '6.2' },
				{ value: '6.3.0', isBeta: false, label: '6.3' },
				{ value: '6.4.0', isBeta: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, label: '6.5.0-beta1' },
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
				{ value: 'latest', isBeta: false, label: 'Latest' },
				{ value: '6.1.0', isBeta: false, label: '6.1' },
				{ value: '6.2.0', isBeta: false, label: '6.2' },
				{ value: '6.3.0', isBeta: false, label: '6.3' },
				{ value: '6.4.0', isBeta: false, label: '6.4' },
				{ value: '6.5.0-beta1', isBeta: true, label: '6.5.0-beta1' },
			] );
		} );
	} );
} );
