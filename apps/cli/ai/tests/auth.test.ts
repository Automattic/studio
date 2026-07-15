import { password } from '@inquirer/prompts';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi } from 'vitest';
import {
	getAvailableAiProviders,
	isAiProviderReady,
	prepareAiProvider,
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { LoggerError } from 'cli/logger';

vi.mock( '@inquirer/prompts', () => ( {
	password: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: vi.fn(),
} ) );

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn().mockResolvedValue( { version: 1, sites: [] } ),
	updateCliConfigWithPartial: vi.fn(),
	getActiveOpenAiCompatibleEndpoint: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'AI auth helpers', () => {
	beforeEach( () => {
		vi.resetAllMocks();
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		delete process.env.WPCOM_AI_PROXY_BASE_URL;
	} );

	it( 'uses the saved Anthropic API key when provider is Anthropic API key', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			anthropicApiKey: 'saved-key',
		} );

		const env = await resolveAiEnvironment( 'anthropic-api-key' );

		expect( env.ANTHROPIC_API_KEY ).toBe( 'saved-key' );
		expect( env.ANTHROPIC_BASE_URL ).toBeUndefined();
		expect( env.ANTHROPIC_AUTH_TOKEN ).toBeUndefined();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );

	it( 'requires a saved Anthropic API key in API key mode', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );

		await expect( resolveAiEnvironment( 'anthropic-api-key' ) ).rejects.toBeInstanceOf(
			LoggerError
		);
		expect( password ).not.toHaveBeenCalled();
	} );

	it( 'prompts for the API key immediately when preparing the API key provider', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		vi.mocked( password ).mockResolvedValue( 'prompted-key' );

		await prepareAiProvider( 'anthropic-api-key' );

		expect( password ).toHaveBeenCalledOnce();
		expect( updateCliConfigWithPartial ).toHaveBeenCalledWith( {
			anthropicApiKey: 'prompted-key',
		} );
	} );

	it( 'can force re-entering the API key even when one is already saved', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			anthropicApiKey: 'saved-key',
		} );
		vi.mocked( password ).mockResolvedValue( 'updated-key' );

		await prepareAiProvider( 'anthropic-api-key', { force: true } );

		expect( password ).toHaveBeenCalledOnce();
		expect( updateCliConfigWithPartial ).toHaveBeenCalledWith( { anthropicApiKey: 'updated-key' } );
	} );

	it( 'lists available providers', async () => {
		await expect( getAvailableAiProviders() ).resolves.toEqual( [
			'wpcom',
			'anthropic-api-key',
			'openai-compatible',
		] );
	} );

	it( 'configures the WP.com gateway environment', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( {
			accessToken: 'wpcom-token',
			displayName: 'User',
			email: 'user@example.com',
			expiresIn: 3600,
			expirationTime: Date.now() + 3600_000,
			id: 1,
		} );

		const env = await resolveAiEnvironment( 'wpcom' );

		expect( env.ANTHROPIC_BASE_URL ).toBe(
			'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy'
		);
		expect( env.ANTHROPIC_AUTH_TOKEN ).toBe( 'wpcom-token' );
		expect( env.ANTHROPIC_CUSTOM_HEADERS ).toBe( 'X-WPCOM-AI-Feature: studio-assistant-anthropic' );
		expect( env.ANTHROPIC_API_KEY ).toBeUndefined();
	} );

	it( 'includes the Studio AI session ID header when provided', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( {
			accessToken: 'wpcom-token',
			displayName: 'User',
			email: 'user@example.com',
			expiresIn: 3600,
			expirationTime: Date.now() + 3600_000,
			id: 1,
		} );

		const env = await resolveAiEnvironment( 'wpcom', { sessionId: 'session-abc' } );

		expect( env.ANTHROPIC_CUSTOM_HEADERS ).toBe(
			'X-WPCOM-AI-Feature: studio-assistant-anthropic\nX-WPCOM-Session-ID: session-abc'
		);
	} );

	it( 'prefers the saved provider', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			aiProvider: 'anthropic-api-key',
			anthropicApiKey: 'key',
		} );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'anthropic-api-key' );
		expect( readAuthToken ).not.toHaveBeenCalled();
	} );

	it( 'defaults to WP.com when no provider is saved and a valid WP.com token exists', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		vi.mocked( readAuthToken ).mockResolvedValue( {
			accessToken: 'wpcom-token',
			displayName: 'User',
			email: 'user@example.com',
			expiresIn: 3600,
			expirationTime: Date.now() + 3600_000,
			id: 1,
		} );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'wpcom' );
	} );

	it( 'falls back to default provider when no other auth is available', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		vi.mocked( readAuthToken ).mockResolvedValue( null );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'wpcom' );
	} );

	it( 'reports WordPress.com readiness based on WP.com auth state', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( {
			accessToken: 'wpcom-token',
			displayName: 'User',
			email: 'user@example.com',
			expiresIn: 3600,
			expirationTime: Date.now() + 3600_000,
			id: 1,
		} );

		await expect( isAiProviderReady( 'wpcom' ) ).resolves.toBe( true );

		vi.mocked( readAuthToken ).mockResolvedValue( null );
		await expect( isAiProviderReady( 'wpcom' ) ).resolves.toBe( false );
	} );

	it( 'resolves a fallback provider only for providers that auto-fallback', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( null );
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			anthropicApiKey: 'saved-key',
		} );

		await expect( resolveUnavailableAiProvider( 'wpcom' ) ).resolves.toBe( 'anthropic-api-key' );
		await expect( resolveUnavailableAiProvider( 'anthropic-api-key' ) ).resolves.toBeUndefined();
	} );
} );
