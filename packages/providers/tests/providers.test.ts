import { describe, expect, it } from 'vitest';
import {
	getAiModelProviders,
	getConnectedMethod,
	getConnectFields,
	getConnectionMethods,
	getRedirectUrl,
	getDefaultAiModel,
	isAiModelId,
	normalizeProviderId,
	toStoredProviderId,
} from '..';

describe( 'provider ids', () => {
	it( 'reads the id builds before `anthropic` stored, and keeps writing it', () => {
		expect( normalizeProviderId( 'anthropic-api-key' ) ).toBe( 'anthropic' );
		expect( normalizeProviderId( 'anthropic' ) ).toBe( 'anthropic' );
		expect( normalizeProviderId( 'wpcom' ) ).toBe( 'wpcom' );
		expect( normalizeProviderId( 'claude-code' ) ).toBeUndefined();
		expect( toStoredProviderId( 'anthropic' ) ).toBe( 'anthropic-api-key' );
		expect( toStoredProviderId( 'wpcom' ) ).toBe( 'wpcom' );
	} );
} );

describe( 'models', () => {
	it( 'finds the providers serving a model', () => {
		expect( getAiModelProviders( 'balanced' ) ).toEqual( [ 'wpcom' ] );
		expect( getAiModelProviders( 'claude-opus-5-5' ) ).toEqual( [ 'anthropic' ] );
		expect( isAiModelId( 'gpt-4' ) ).toBe( false );
	} );

	it( 'defaults to the paid model only when paid credits remain', () => {
		expect( getDefaultAiModel( 'wpcom' ) ).toBe( 'fast' );
		expect( getDefaultAiModel( 'wpcom', { canUsePaidModels: true } ) ).toBe( 'balanced' );
		expect( getDefaultAiModel( 'anthropic', { canUsePaidModels: true } ) ).toBe(
			'claude-sonnet-5-5'
		);
	} );
} );

describe( 'connections', () => {
	it( 'describes a form provider’s fields for any surface to render', () => {
		const [ apiKey, ...others ] = getConnectFields( 'anthropic' );

		expect( others ).toEqual( [] );
		expect( apiKey ).toMatchObject( {
			name: 'apiKey',
			title: 'Anthropic API key',
			placeholder: 'sk-…',
			secret: true,
		} );
		expect( apiKey.validate( ' ' ) ).toBe( 'API key is required' );
		expect( apiKey.validate( 'sk-ant-key' ) ).toBeUndefined();
		expect( getConnectFields( 'wpcom' ) ).toEqual( [] );
	} );

	it( 'lets the user pick a method only when a provider offers several', () => {
		expect( getConnectionMethods( 'anthropic' ).map( ( { id } ) => id ) ).toEqual( [
			'api-key',
			'setup-token',
		] );
		expect( getConnectionMethods( 'wpcom' ) ).toEqual( [] );
		expect( getConnectionMethods( 'spacefast' ) ).toEqual( [] );

		const [ token ] = getConnectFields( 'anthropic', 'setup-token' );
		expect( token ).toMatchObject( { name: 'token', placeholder: 'sk-ant-oat01-…', secret: true } );
		expect( token.validate( 'sk-ant-api03-key' ) ).toMatch( /not an API key/ );
		expect( getConnectedMethod( 'anthropic', { method: 'setup-token', token: 'x' } ) ).toBe(
			'setup-token'
		);
	} );

	it( 'builds the redirect only for a provider that connects with one', () => {
		expect( getRedirectUrl( 'wpcom', { redirectUri: 'wp-studio://auth', locale: 'en' } ) ).toMatch(
			/^https:\/\/public-api\.wordpress\.com\/oauth2\/authorize\?/
		);
		expect( () => getRedirectUrl( 'anthropic', { redirectUri: 'x', locale: 'en' } ) ).toThrow();
	} );
} );
