import { describe, expect, it } from 'vitest';
import {
	AI_PROVIDER_IDS,
	findAiModel,
	getConnectMethod,
	getDefaultAiModel,
	getFormFields,
	getProvider,
	normalizeProviderId,
	PROVIDER_IDS,
	servesAiModel,
	SITES_PROVIDER_IDS,
	toStoredProviderId,
} from '..';
import type { ConnectMethod } from '../types';
import { getProviderServices } from '../services';
import { getProviderUi } from '../ui';

describe( 'registry', () => {
	it( 'registers each provider with services for what it declares', () => {
		for ( const id of PROVIDER_IDS ) {
			const { ai, sites, account } = getProvider( id );
			const services = getProviderServices( id );

			expect( services.id ).toBe( id );
			expect( Boolean( services.ai ) ).toBe( Boolean( ai ) );
			expect( Boolean( services.sites ) ).toBe( Boolean( sites ) );
			expect( Boolean( services.account ) ).toBe( Boolean( account ) );
			expect( ! ai || servesAiModel( id, ai.defaultModel ) ).toBe( true );
			// The Studio sign-in, which each app receives its own way.
			expect(
				id === 'wpcom' || ! account || account.methods.every( ( { kind } ) => kind !== 'redirect' )
			).toBe( true );
		}
	} );

	it( 'gives a provider whose sites connect with a form the component that renders it', () => {
		for ( const id of SITES_PROVIDER_IDS ) {
			expect( Boolean( getProviderUi( id ).ConnectForm ) ).toBe(
				Boolean( getProvider( id ).sites!.connect )
			);
		}
	} );
} );

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
		// A catalog provider's, by the prefix its ids start with.
		expect( findAiModel( 'kimi-k3' )?.provider ).toBe( 'github-copilot' );
		expect( findAiModel( 'mistral-large' ) ).toBeUndefined();
	} );

	it( 'names a model a local server lists without reaching the server', () => {
		const found = findAiModel( 'local-llm/hf.co/unsloth/Qwen3-4B:Q4_K_M' );

		expect( found?.provider ).toBe( 'local-llm' );
		expect( found?.model.label() ).toBe( 'hf.co/unsloth/Qwen3-4B:Q4_K_M' );
		expect( found?.model.supportsImages ).toBeUndefined();
		expect( findAiModel( 'anthropic/claude-opus-5-5' ) ).toBeUndefined();
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
	const formFields = ( method: ConnectMethod ) =>
		method.kind === 'form' ? getFormFields( method.input() ) : [];

	it( 'describes a form’s fields for any surface to render', () => {
		const [ apiKey, ...others ] = formFields( getConnectMethod( 'anthropic' ) );

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
		expect( formFields( getConnectMethod( 'wpcom' ) ) ).toEqual( [] );
	} );

	it( 'marks a field whose schema takes an empty value as optional', () => {
		expect( formFields( getConnectMethod( 'local-llm' ) ) ).toMatchObject( [
			{ name: 'address', secret: false, required: true },
			{ name: 'apiKey', secret: true, required: false },
		] );
	} );

	it( 'finds a method by id, or the first', () => {
		expect( getProvider( 'anthropic' ).account!.methods.map( ( { id } ) => id ) ).toEqual( [
			'api-key',
			'setup-token',
		] );
		expect( getConnectMethod( 'anthropic', 'setup-token' ).id ).toBe( 'setup-token' );
		expect( getConnectMethod( 'anthropic', 'unknown' ).id ).toBe( 'api-key' );
		expect( formFields( getConnectMethod( 'anthropic', 'setup-token' ) ) ).toMatchObject( [
			{ name: 'token', placeholder: 'sk-ant-oat01-…', secret: true },
		] );
	} );
} );
