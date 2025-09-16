/**
 * @jest-environment node
 */

import { setFeatureFlagInEnv } from 'src/lib/feature-flags';
import { getWordPressProvider, getWordPressProviderType } from './index';

// Reset any existing provider instance between tests
beforeEach( () => {
	// Clear any cached provider
	jest.resetModules();
} );

describe( 'WordPress Provider Selection', () => {
	it( 'should use WpNowProvider when useWpNowProvider flag is true', () => {
		setFeatureFlagInEnv( 'useWpNowProvider', true );

		const provider = getWordPressProvider();
		const providerType = getWordPressProviderType();

		expect( provider.PROVIDER_TYPE ).toBe( 'wp-now' );
		expect( providerType ).toBe( 'wp-now' );
	} );

	it( 'should use PlaygroundCliProvider when useWpNowProvider flag is false', () => {
		setFeatureFlagInEnv( 'useWpNowProvider', false );

		const provider = getWordPressProvider();
		const providerType = getWordPressProviderType();

		expect( provider.PROVIDER_TYPE ).toBe( 'playground-cli' );
		expect( providerType ).toBe( 'playground-cli' );
	} );

	it( 'should default to WpNowProvider when flag is not set', () => {
		delete process.env.USE_WP_NOW_PROVIDER;

		const provider = getWordPressProvider();
		const providerType = getWordPressProviderType();

		expect( provider.PROVIDER_TYPE ).toBe( 'wp-now' );
		expect( providerType ).toBe( 'wp-now' );
	} );
} );
