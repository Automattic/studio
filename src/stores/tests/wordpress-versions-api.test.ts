import { configureStore } from '@reduxjs/toolkit';
import nock from 'nock';
import { ZodError } from 'zod';
import { store } from '..';
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

describe( 'WordPress Versions API', () => {
	afterEach( () => {
		nock.cleanAll();
	} );

	describe( 'fetchWordPressVersions', () => {
		it( 'should fetch both stable and development versions', async () => {
			nock( 'https://api.wordpress.org' )
				.get( '/core/version-check/1.7/' )
				.query( { channel: 'beta', version: '5.9.9' } )
				.reply( 200, {
					offers: [
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.5.0-beta1', response: 'autoupdate' },
					],
				} );

			nock( 'https://api.wordpress.org' )
				.get( '/core/version-check/1.7/' )
				.query( { channel: 'development' } )
				.reply( 200, {
					offers: [
						{ version: '6.8-beta2-59979', response: 'development' },
						{ version: '6.8-beta2-59980', response: 'development' },
					],
				} );

			const store = createTestStore();
			const result = await store.dispatch(
				wordpressVersionsApi.endpoints.getWordPressVersions.initiate( { minimumVersion: '5.9.9' } )
			);

			// Verify both API calls were made
			expect( nock.isDone() ).toBe( true );

		// Verify the result includes both stable and development versions
		expect( result.data ).toEqual( [
			{
				value: 'latest',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
				actualVersion: '6.4.0',
			},
			{
				value: '6.8-beta2-59979',
				isBeta: true,
				isDevelopment: true,
				label: 'nightly',
				actualVersion: '6.8-beta2-59979',
			},
			{
				value: '6.4.0',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
				actualVersion: '6.4.0',
			},
			{
				value: '6.5.0-beta1',
				isBeta: true,
				isDevelopment: false,
				label: '6.5.0-beta1',
				actualVersion: '6.5.0-beta1',
			},
		] );
		} );
	} );

	it( 'should handle development versions with correct labeling', async () => {
		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				offers: [],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, {
				offers: [
					{ version: '6.8-alpha1-59979', response: 'development' },
					{ version: '6.8-beta2-59980', response: 'development' },
					{ version: '6.8-rc1-59981', response: 'development' },
				],
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
			actualVersion: '6.8-alpha1-59979',
		},
	] );
	} );

	it( 'should handle schema validation error for both channels', async () => {
		const consoleSpy = jest.spyOn( console, 'error' ).mockImplementation( () => {} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				// Missing 'offers' field to trigger schema validation error
				something_else: [],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, {
				// Missing 'offers' field to trigger schema validation error
				something_else: [],
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
				message: 'Required',
				path: [ 'offers' ],
				received: 'undefined',
			},
		] );

		expect( result.data ).toBeUndefined();

		consoleSpy.mockRestore();
	} );

	it( 'should update versions when API call is successful', async () => {
		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				offers: [
					{ version: '6.4.0', response: 'autoupdate' },
					{ version: '6.5.0-beta1', response: 'autoupdate' },
					{ version: '6.3.0', response: 'upgrade' }, // Should be filtered out
				],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, { offers: [] } );

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
			actualVersion: '6.4.0',
		},
		{
			value: '6.4.0',
			isBeta: false,
			isDevelopment: false,
			label: '6.4',
			actualVersion: '6.4.0',
		},
		{
			value: '6.5.0-beta1',
			isBeta: true,
			isDevelopment: false,
			label: '6.5.0-beta1',
			actualVersion: '6.5.0-beta1',
		},
	] );
	} );

	it( 'should handle API response with no autoupdate offers', async () => {
		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				offers: [
					{ version: '6.3.0', response: 'upgrade' },
					{ version: '6.2.0', response: 'upgrade' },
				],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, { offers: [] } );

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

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.replyWithError( 'Network error' );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.replyWithError( 'Network error' );

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
		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				offers: [
					{ version: '6.4.0', response: 'autoupdate' },
					{ version: '6.5.0-beta1', response: 'autoupdate' },
					{ version: '6.5.0-RC1', response: 10 }, // Invalid response type
				],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, { offers: [] } );

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
		actualVersion: '6.4.0',
	} );
	expect( versions[ 1 ] ).toEqual( {
		value: '6.4.0',
		isBeta: false,
		isDevelopment: false,
		label: '6.4',
		actualVersion: '6.4.0',
	} );
	expect( versions[ 2 ] ).toEqual( {
		value: '6.5.0-beta1',
		isBeta: true,
		isDevelopment: false,
		label: '6.5.0-beta1',
		actualVersion: '6.5.0-beta1',
	} );
	} );

	it( 'should correctly identify beta and RC versions and use full version for name', async () => {
		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				offers: [
					{ version: '6.4.0', response: 'autoupdate' },
					{ version: '6.5.0-beta1', response: 'autoupdate' },
					{ version: '6.5.0-RC1', response: 'autoupdate' },
				],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, { offers: [] } );

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
			actualVersion: '6.4.0',
		},
		{
			value: '6.4.0',
			isBeta: false,
			isDevelopment: false,
			label: '6.4',
			actualVersion: '6.4.0',
		},
		{
			value: '6.5.0-beta1',
			isBeta: true,
			isDevelopment: false,
			label: '6.5.0-beta1',
			actualVersion: '6.5.0-beta1',
		},
		{
			value: '6.5.0-RC1',
			isBeta: true,
			isDevelopment: false,
			label: '6.5.0-RC1',
			actualVersion: '6.5.0-RC1',
		},
	] );
	} );

	it( 'should handle unusual version formats', async () => {
		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
				offers: [
					{ version: '10.11.12', response: 'autoupdate' },
					{ version: '6.5-dev', response: 'autoupdate' },
				],
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, { offers: [] } );

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
			actualVersion: '10.11.12',
		},
		{
			value: '10.11.12',
			isBeta: false,
			isDevelopment: false,
			label: '10.11',
			actualVersion: '10.11.12',
		},
		{
			value: '6.5-dev',
			isBeta: false,
			isDevelopment: false,
			label: '6.5',
			actualVersion: '6.5-dev',
		},
	] );
	} );

	it( 'should handle multiple patch versions of the same minor', async () => {
		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'beta', version: '5.9.9' } )
			.reply( 200, {
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
			} );

		nock( 'https://api.wordpress.org' )
			.get( '/core/version-check/1.7/' )
			.query( { channel: 'development' } )
			.reply( 200, { offers: [] } );

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
			actualVersion: '6.7.2',
		},
		{
			value: '6.7.2',
			isBeta: false,
			isDevelopment: false,
			label: '6.7.2',
			actualVersion: '6.7.2',
		},
		{ value: '6.7.1', isBeta: false, isDevelopment: false, label: '6.7.1', actualVersion: '6.7.1' },
		{ value: '6.6.2', isBeta: false, isDevelopment: false, label: '6.6', actualVersion: '6.6.2' },
		{ value: '6.5.5', isBeta: false, isDevelopment: false, label: '6.5', actualVersion: '6.5.5' },
	] );
	} );

	describe( 'selectors', () => {
		it( 'should select WordPress versions with name property', async () => {
			nock( 'https://api.wordpress.org' )
				.get( '/core/version-check/1.7/' )
				.query( { channel: 'beta', version: '5.9.9' } )
				.reply( 200, {
					offers: [
						{ version: '6.5.0-beta1', response: 'autoupdate' },
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.3.0', response: 'autoupdate' },
						{ version: '6.2.0', response: 'autoupdate' },
						{ version: '6.1.0', response: 'autoupdate' },
					],
				} );

			nock( 'https://api.wordpress.org' )
				.get( '/core/version-check/1.7/' )
				.query( { channel: 'development' } )
				.reply( 200, { offers: [] } );

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
				actualVersion: '6.4.0',
			},
			{
				value: '6.5.0-beta1',
				isBeta: true,
				isDevelopment: false,
				label: '6.5.0-beta1',
				actualVersion: '6.5.0-beta1',
			},
			{
				value: '6.4.0',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
				actualVersion: '6.4.0',
			},
			{ value: '6.3.0', isBeta: false, isDevelopment: false, label: '6.3', actualVersion: '6.3.0' },
			{ value: '6.2.0', isBeta: false, isDevelopment: false, label: '6.2', actualVersion: '6.2.0' },
			{
				value: '6.1.0',
				isBeta: false,
				isDevelopment: false,
				label: '6.1',
				actualVersion: '6.1.0',
			},
		] );
		} );

		it( 'should select WordPress versions with latest', async () => {
			nock( 'https://api.wordpress.org' )
				.get( '/core/version-check/1.7/' )
				.query( { channel: 'beta', version: '5.9.9' } )
				.reply( 200, {
					offers: [
						{ version: '6.5.0-beta1', response: 'autoupdate' },
						{ version: '6.4.0', response: 'autoupdate' },
						{ version: '6.3.0', response: 'autoupdate' },
						{ version: '6.2.0', response: 'autoupdate' },
						{ version: '6.1.0', response: 'autoupdate' },
					],
				} );

			nock( 'https://api.wordpress.org' )
				.get( '/core/version-check/1.7/' )
				.query( { channel: 'development' } )
				.reply( 200, { offers: [] } );

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
				actualVersion: '6.4.0',
			},
			{
				value: '6.5.0-beta1',
				isBeta: true,
				isDevelopment: false,
				label: '6.5.0-beta1',
				actualVersion: '6.5.0-beta1',
			},
			{
				value: '6.4.0',
				isBeta: false,
				isDevelopment: false,
				label: '6.4',
				actualVersion: '6.4.0',
			},
			{ value: '6.3.0', isBeta: false, isDevelopment: false, label: '6.3', actualVersion: '6.3.0' },
			{ value: '6.2.0', isBeta: false, isDevelopment: false, label: '6.2', actualVersion: '6.2.0' },
			{ value: '6.1.0', isBeta: false, isDevelopment: false, label: '6.1', actualVersion: '6.1.0' },
		] );
		} );
	} );
} );
