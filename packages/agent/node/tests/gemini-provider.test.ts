import { describe, expect, it, vi } from 'vitest';
import { getAiProvider, getAiProviderModels } from '@studio/agent/protocol/providers';
import { AI_BACKEND_PROVIDERS, InvalidAiProviderCredentialsError } from '../providers';
import { createApiKeyStudioProvider } from '../providers/api-key-provider';
import { geminiProvider } from '../providers/gemini';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

describe( 'geminiProvider', () => {
	it.each( [
		[ 'gemini-3.8-flash', 65_536 ],
		[ 'gemini-4-argon', 32_768 ],
		[ 'gemini-4-carbon', 65_536 ],
	] as const )(
		'builds a google-generative-ai runtime model for %s with Gemini thinking support',
		( modelId, expectedMaxTokens ) => {
			const model = geminiProvider.buildModel(
				modelId,
				{
					apiKey: 'AIzaSyTestKey1234',
					baseURL: 'https://generativelanguage.googleapis.com/v1beta///',
				},
				{ supportsImages: true }
			);

			expect( model ).toMatchObject( {
				id: modelId,
				api: 'google-generative-ai',
				provider: 'google',
				baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
				input: [ 'text', 'image' ],
				reasoning: true,
				contextWindow: 200_000,
				maxTokens: expectedMaxTokens,
			} );
			expect( model.thinkingLevelMap ).toMatchObject( {
				off: null,
				minimal: null,
				low: 'low',
				medium: 'medium',
				high: 'high',
			} );
			expect( model.inputLimits ).toBeDefined();
		}
	);

	it( 'restricts input to text when supportsImages is false', () => {
		const model = geminiProvider.buildModel(
			'gemini-3.8-flash',
			{
				apiKey: 'AIzaSyTestKey1234',
				baseURL: 'https://generativelanguage.googleapis.com/v1beta',
			},
			{ supportsImages: false }
		);

		expect( model.input ).toEqual( [ 'text' ] );
	} );

	it( 'registers the runtime API key under the google provider id', async () => {
		const setRuntimeApiKey = vi.fn().mockResolvedValue( undefined );
		const runtime = { setRuntimeApiKey } as unknown as ModelRuntime;
		const model = geminiProvider.buildModel(
			'gemini-3.8-flash',
			{
				apiKey: 'AIzaSyTestKey1234',
				baseURL: 'https://generativelanguage.googleapis.com/v1beta',
			},
			{ supportsImages: true }
		);

		await geminiProvider.configureRuntime( runtime, model, {
			apiKey: 'AIzaSyTestKey1234',
			baseURL: 'https://generativelanguage.googleapis.com/v1beta',
		} );

		expect( setRuntimeApiKey ).toHaveBeenCalledWith( 'google', 'AIzaSyTestKey1234' );
	} );
} );

describe( 'createApiKeyStudioProvider and gemini-api-key registration', () => {
	it( 'exposes gemini-api-key in the shared provider catalog with Flash and Gemini 4 tiers', () => {
		const descriptor = getAiProvider( 'gemini-api-key' );
		expect( descriptor ).toMatchObject( {
			id: 'gemini-api-key',
			label: 'Google Gemini API',
			cliLabel: 'Google Gemini · API key',
			modelLabel: 'Gemini',
			usesStudioCredits: false,
			connection: { type: 'api-key' },
			defaultModel: 'gemini-3.8-flash',
		} );
		expect( getAiProviderModels( 'gemini-api-key' ).map( ( m ) => m.id ) ).toEqual( [
			'gemini-3.8-flash',
			'gemini-4-argon',
			'gemini-4-carbon',
		] );
	} );

	it( 'resolves environment and runtime credentials for gemini-api-key', async () => {
		const backend = AI_BACKEND_PROVIDERS[ 'gemini-api-key' ];
		expect( backend.environmentKeys ).toContain( 'GEMINI_API_KEY' );
		expect( backend.environmentKeys ).toContain( 'GOOGLE_API_KEY' );

		await expect(
			backend.resolveEnv( { apiKey: 'AIzaSyTest1234', userAgent: 'StudioTest/1.0' } )
		).resolves.toEqual( {
			GEMINI_API_KEY: 'AIzaSyTest1234',
		} );

		await expect(
			backend.resolveEnv( { apiKey: undefined, userAgent: 'StudioTest/1.0' } )
		).rejects.toBeInstanceOf( InvalidAiProviderCredentialsError );

		expect( backend.resolveCredentials( { GEMINI_API_KEY: '  AIzaSyTest1234  ' } ) ).toEqual( {
			ok: true,
			creds: {
				apiKey: 'AIzaSyTest1234',
				baseURL: 'https://generativelanguage.googleapis.com/v1beta',
			},
		} );
		expect( backend.resolveCredentials( {} ) ).toMatchObject( { ok: false } );
	} );

	it( 'builds reusable Studio API-key providers via createApiKeyStudioProvider', async () => {
		const custom = createApiKeyStudioProvider( geminiProvider, {
			envKey: 'CUSTOM_AI_KEY',
			extraEnvironmentKeys: [ 'CUSTOM_AI_BASE_URL' ],
			baseURL: 'https://api.example.test/v1',
			getInvalidKeyMessage: () => 'Localized invalid key',
			getPrompt: () => 'Enter custom key:',
			getMissingKeyMessage: () => 'Custom key missing.',
			getErrorHint: () => 'Run /api-key.',
			getNoSavedKeyInfo: () => 'No custom key saved.',
			getEnvRequiredMessage: () => 'Custom key required.',
			missingEnvReason: 'CUSTOM_AI_KEY is not set.',
		} );

		expect( custom.environmentKeys ).toEqual( [ 'CUSTOM_AI_KEY', 'CUSTOM_AI_BASE_URL' ] );
		expect( await custom.getConnectionMessages?.( undefined ) ).toEqual( {
			info: 'No custom key saved.',
		} );
		expect( await custom.getConnectionMessages?.( 'secret' ) ).toEqual( {} );
		expect( custom.getErrorHint?.() ).toBe( 'Run /api-key.' );
	} );
} );
