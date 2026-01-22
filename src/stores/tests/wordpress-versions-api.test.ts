import { configureStore } from '@reduxjs/toolkit';
import { vi } from 'vitest';
import { ZodError } from 'zod';
import { wordpressVersionsApi } from '../wordpress-versions-api';

const createTestStore = () => {
	return configureStore( {
		reducer: {
			[ wordpressVersionsApi.reducerPath ]: wordpressVersionsApi.reducer,
		},
		middleware: ( getDefaultMiddleware ) =>
			getDefaultMiddleware().concat( wordpressVersionsApi.middleware ),
	} );
};

const originalFetch = global.fetch;

function mockWordPressApi( responses: {
	beta?: any;
	development?: any;
	betaError?: boolean;
	developmentError?: boolean;
} ) {
	const callsMade = { beta: false, development: false };

	global.fetch = vi.fn().mockImplementation( async ( url: string, options?: RequestInit ) => {
		const urlObj = new URL( url as string );
		if (
			urlObj.hostname === 'api.wordpress.org' &&
			urlObj.pathname === '/core/version-check/1.7/'
		) {
			const channel = urlObj.searchParams.get( 'channel' );

			if ( channel === 'beta' ) {
				callsMade.beta = true;
				if ( responses.betaError ) {
					return Promise.reject( new Error( 'Network error' ) );
				}
				return Promise.resolve( {
					ok: true,
					status: 200,
					json: () => Promise.resolve( responses.beta || { offers: [] } ),
				} as Response );
			}

			if ( channel === 'development' ) {
				callsMade.development = true;
				if ( responses.developmentError ) {
					return Promise.reject( new Error( 'Network error' ) );
				}
				return Promise.resolve( {
					ok: true,
					status: 200,
					json: () => Promise.resolve( responses.development || { offers: [] } ),
				} as Response );
			}
		}
		return originalFetch( url, options );
	} );

	return {
		isDone: () => {
			const expectedBeta = responses.beta !== undefined || responses.betaError;
			const expectedDevelopment = responses.development !== undefined || responses.developmentError;
			return (
				( ! expectedBeta || callsMade.beta ) && ( ! expectedDevelopment || callsMade.development )
			);
		},
	};
}

describe( 'WordPress Versions API', () => {
	beforeEach( () => {
		global.fetch = vi.fn();
	} );

	afterEach( () => {
		global.fetch = originalFetch;
	} );

	describe( 'fetchWordPressVersions', () => {
		it( 'should fetch both stable and development versions', async () => {
			const mockApi = mockWordPressApi( {
				beta: {
					offers: [
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.5.0-beta1', response: 'autoupdate' },
					],
				},
				development: {
					offers: [
						{ version: '6.8-beta2-59979', response: 'development' },
						{ version: '6.8-beta2-59980', response: 'development' },
					],
				},
			} );

			const store = createTestStore();
			const result = await store.dispatch(
				wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
			);

			// Verify both API calls were made
			expect( mockApi.isDone() ).toBe( true );

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
		mockWordPressApi( {
			beta: {
				offers: [],
			},
			development: {
				offers: [
					{ version: '6.8-alpha1-59979', response: 'development' },
					{ version: '6.8-beta2-59980', response: 'development' },
					{ version: '6.8-rc1-59981', response: 'development' },
				],
			},
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
		const consoleSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );

		mockWordPressApi( {
			beta: {
				// Missing 'offers' field to trigger schema validation error
				something_else: [],
			},
			development: {
				// Missing 'offers' field to trigger schema validation error
				something_else: [],
			},
		} );

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
				message: 'Invalid input: expected array, received undefined',
				path: [ 'offers' ],
			},
		] );

		expect( result.data ).toBeUndefined();

		consoleSpy.mockRestore();
	} );

	it( 'should update versions when API call is successful', async () => {
		mockWordPressApi( {
			beta: {
				offers: [
					{ version: '6.4.0', response: 'autoupdate' },
					{ version: '6.5.0-beta1', response: 'autoupdate' },
					{ version: '6.3.0', response: 'upgrade' }, // Should be filtered out
				],
			},
			development: { offers: [] },
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
		mockWordPressApi( {
			beta: {
				offers: [
					{ version: '6.3.0', response: 'upgrade' },
					{ version: '6.2.0', response: 'upgrade' },
				],
			},
			development: { offers: [] },
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
		const consoleSpy = vi.spyOn( console, 'error' ).mockImplementation( () => {} );

		mockWordPressApi( {
			betaError: true,
			developmentError: true,
		} );

		const store = createTestStore();
		const result = await store.dispatch(
			wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
		);
		expect( result.isError ).toBe( true );
		expect( result.error ).toBeDefined();
		if ( 'message' in result.error! ) {
			expect( result.error.message ).toContain( 'Network error' );
		}

		expect( result.data ).toBeUndefined();

		consoleSpy.mockRestore();
	} );

	it( 'should gracefully handle schema validation errors for individual offers', async () => {
		mockWordPressApi( {
			beta: {
				offers: [
					{ version: '6.4.0', response: 'autoupdate' },
					{ version: '6.5.0-beta1', response: 'autoupdate' },
					{ version: '6.5.0-RC1', response: 10 }, // Invalid response type
				],
			},
			development: { offers: [] },
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
		mockWordPressApi( {
			beta: {
				offers: [
					{ version: '6.4.0', response: 'autoupdate' },
					{ version: '6.5.0-beta1', response: 'autoupdate' },
					{ version: '6.5.0-RC1', response: 'autoupdate' },
				],
			},
			development: { offers: [] },
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
		mockWordPressApi( {
			beta: {
				offers: [
					{ version: '10.11.12', response: 'autoupdate' },
					{ version: '6.5-dev', response: 'autoupdate' },
				],
			},
			development: { offers: [] },
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
		mockWordPressApi( {
			beta: {
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
			},
			development: { offers: [] },
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
			mockWordPressApi( {
				beta: {
					offers: [
						{ version: '6.5.0-beta1', response: 'autoupdate' },
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.3.0', response: 'autoupdate' },
						{ version: '6.2.0', response: 'autoupdate' },
						{ version: '6.1.0', response: 'autoupdate' },
					],
				},
				development: { offers: [] },
			} );

			const store = createTestStore();
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
			mockWordPressApi( {
				beta: {
					offers: [
						{ version: '6.5.0-beta1', response: 'autoupdate' },
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.3.0', response: 'autoupdate' },
						{ version: '6.2.0', response: 'autoupdate' },
						{ version: '6.1.0', response: 'autoupdate' },
					],
				},
				development: { offers: [] },
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
