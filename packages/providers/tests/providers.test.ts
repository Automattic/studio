import { describe, expect, it } from 'vitest';
import {
	AI_PROVIDER_IDS,
	findAiModel,
	getAiModels,
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

	it( 'names a model a local server lists without reaching the server', () => {
		const found = findAiModel( 'local-llm/hf.co/unsloth/Qwen3-4B:Q4_K_M' );

		expect( found?.provider ).toBe( 'local-llm' );
		expect( found?.model.label() ).toBe( 'hf.co/unsloth/Qwen3-4B:Q4_K_M' );
		expect( found?.model.supportsImages ).toBeUndefined();
		expect( findAiModel( 'anthropic/claude-opus-5-5' ) ).toBeUndefined();
		expect( getAiModels( 'local-llm' ) ).toEqual( [] );
		// Last in the fallback order, so WordPress.com stays first.
		expect( AI_PROVIDER_IDS.at( -1 ) ).toBe( 'local-llm' );
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
			required: true,
		} );
		expect( apiKey.validate( ' ' ) ).toBe( 'API key is required' );
		expect( apiKey.validate( 'sk-ant-key' ) ).toBeUndefined();
		expect( getConnectFields( getConnectMethod( 'wpcom' ) ) ).toEqual( [] );
	} );

	it( 'marks a field whose schema takes an empty value as optional', () => {
		expect( getConnectFields( getConnectMethod( 'local-llm' ) ) ).toMatchObject( [
			{ name: 'address', secret: false, required: true },
			{ name: 'apiKey', secret: true, required: false },
		] );
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
