import { describe, expect, it } from 'vitest';
import {
	findAiModel,
	getConnectFields,
	getConnectMethod,
	getDefaultAiModel,
	getProvider,
	normalizeProviderId,
	SITES_PROVIDER_IDS,
	toStoredProviderId,
} from '..';

describe( 'provider ids', () => {
	it( 'reads the id builds before `anthropic` stored, and keeps writing it', () => {
		expect( normalizeProviderId( 'anthropic-api-key' ) ).toBe( 'anthropic' );
		expect( normalizeProviderId( 'anthropic' ) ).toBe( 'anthropic' );
		expect( normalizeProviderId( 'claude-code' ) ).toBeUndefined();
		expect( normalizeProviderId( 'anthropic', SITES_PROVIDER_IDS ) ).toBeUndefined();
		expect( toStoredProviderId( 'anthropic' ) ).toBe( 'anthropic-api-key' );
		expect( toStoredProviderId( 'wpcom' ) ).toBe( 'wpcom' );
	} );
} );

describe( 'models', () => {
	it( 'finds the provider serving a model', () => {
		expect( findAiModel( 'balanced' )?.provider ).toBe( 'wpcom' );
		expect( findAiModel( 'claude-opus-5-5' )?.provider ).toBe( 'anthropic' );
		expect( findAiModel( 'gpt-4' ) ).toBeUndefined();
	} );

	it( 'defaults to the paid model only when paid credits remain', () => {
		expect( getDefaultAiModel( 'wpcom' ) ).toBe( 'fast' );
		expect( getDefaultAiModel( 'wpcom', { canUsePaidModels: true } ) ).toBe( 'balanced' );
		expect( getDefaultAiModel( 'anthropic', { canUsePaidModels: true } ) ).toBe(
			'claude-sonnet-5-5'
		);
	} );
} );

describe( 'connecting', () => {
	it( 'describes a form’s fields for any surface to render', () => {
		const [ apiKey, ...others ] = getConnectFields( getConnectMethod( 'anthropic' ) );

		expect( others ).toEqual( [] );
		expect( apiKey ).toMatchObject( {
			name: 'apiKey',
			title: 'Anthropic API key',
			placeholder: 'sk-…',
			secret: true,
		} );
		expect( apiKey.validate( ' ' ) ).toBe( 'API key is required' );
		expect( apiKey.validate( 'sk-ant-key' ) ).toBeUndefined();
		expect( getConnectFields( getConnectMethod( 'wpcom' ) ) ).toEqual( [] );
	} );

	it( 'finds a method by id, or the first', () => {
		expect( getProvider( 'anthropic' ).account.methods.map( ( { id } ) => id ) ).toEqual( [
			'api-key',
			'setup-token',
		] );
		expect( getConnectMethod( 'anthropic', 'setup-token' ).id ).toBe( 'setup-token' );
		expect( getConnectMethod( 'anthropic', 'unknown' ).id ).toBe( 'api-key' );
		expect( getConnectFields( getConnectMethod( 'anthropic', 'setup-token' ) ) ).toMatchObject( [
			{ name: 'token', placeholder: 'sk-ant-oat01-…', secret: true },
		] );
	} );
} );
