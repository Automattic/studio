import { password } from '@inquirer/prompts';
import {
	persistAnthropicApiKey,
	readAnthropicApiKey,
	readSelectedAiProvider,
} from '@studio/common/ai/settings-store';
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
import { LoggerError } from 'cli/logger';

vi.mock( '@inquirer/prompts', () => ( {
	password: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: vi.fn(),
} ) );

vi.mock( '@studio/common/ai/settings-store', () => ( {
	readAnthropicApiKey: vi.fn(),
	readSelectedAiProvider: vi.fn(),
	persistAnthropicApiKey: vi.fn(),
	persistSelectedAiProvider: vi.fn(),
} ) );

describe( 'AI auth helpers', () => {
	beforeEach( () => {
		vi.resetAllMocks();
		vi.stubGlobal( '__STUDIO_CLI_VERSION__', '1.2.3' );
		delete process.env.WPCOM_AI_PROXY_BASE_URL;
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'uses the saved Anthropic API key when provider is Anthropic API key', async () => {
		vi.mocked( readAnthropicApiKey ).mockResolvedValue( 'saved-key' );

		const env = await resolveAiEnvironment( 'anthropic-api-key' );

		expect( env.ANTHROPIC_API_KEY ).toBe( 'saved-key' );
		expect( env.ANTHROPIC_BASE_URL ).toBeUndefined();
		expect( env.ANTHROPIC_AUTH_TOKEN ).toBeUndefined();
		expect( persistAnthropicApiKey ).not.toHaveBeenCalled();
	} );

	it( 'requires a saved Anthropic API key in API key mode', async () => {
		vi.mocked( readAnthropicApiKey ).mockResolvedValue( undefined );

		await expect( resolveAiEnvironment( 'anthropic-api-key' ) ).rejects.toBeInstanceOf(
			LoggerError
		);
		expect( password ).not.toHaveBeenCalled();
	} );

	it( 'prompts for the API key immediately when preparing the API key provider', async () => {
		vi.mocked( readAnthropicApiKey ).mockResolvedValue( undefined );
		vi.mocked( password ).mockResolvedValue( 'prompted-key' );

		await prepareAiProvider( 'anthropic-api-key' );

		expect( password ).toHaveBeenCalledOnce();
		expect( persistAnthropicApiKey ).toHaveBeenCalledWith( 'prompted-key' );
	} );

	it( 'can force re-entering the API key even when one is already saved', async () => {
		vi.mocked( readAnthropicApiKey ).mockResolvedValue( 'saved-key' );
		vi.mocked( password ).mockResolvedValue( 'updated-key' );

		await prepareAiProvider( 'anthropic-api-key', { force: true } );

		expect( password ).toHaveBeenCalledOnce();
		expect( persistAnthropicApiKey ).toHaveBeenCalledWith( 'updated-key' );
	} );

	it( 'lists available providers', async () => {
		await expect( getAvailableAiProviders() ).resolves.toEqual( [ 'wpcom', 'anthropic-api-key' ] );
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

		expect( env.STUDIO_WPCOM_BASE_URL ).toBe(
			'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy/v1'
		);
		expect( env.STUDIO_WPCOM_API_KEY ).toBe( 'wpcom-token' );
		expect( JSON.parse( env.STUDIO_WPCOM_DEFAULT_HEADERS! ) ).toEqual( {
			'User-Agent': 'WordPressStudio/1.2.3',
			'X-WPCOM-AI-Feature': 'studio-agent',
		} );
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

		expect( JSON.parse( env.STUDIO_WPCOM_DEFAULT_HEADERS! ) ).toEqual( {
			'User-Agent': 'WordPressStudio/1.2.3',
			'X-WPCOM-AI-Feature': 'studio-agent',
			'X-WPCOM-Session-ID': 'session-abc',
		} );
	} );

	it( 'prefers the saved provider', async () => {
		vi.mocked( readSelectedAiProvider ).mockResolvedValue( 'anthropic-api-key' );
		vi.mocked( readAnthropicApiKey ).mockResolvedValue( 'key' );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'anthropic-api-key' );
		expect( readAuthToken ).not.toHaveBeenCalled();
	} );

	it( 'defaults to WP.com when no provider is saved and a valid WP.com token exists', async () => {
		vi.mocked( readSelectedAiProvider ).mockResolvedValue( undefined );
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
		vi.mocked( readSelectedAiProvider ).mockResolvedValue( undefined );
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
		vi.mocked( readAnthropicApiKey ).mockResolvedValue( 'saved-key' );

		await expect( resolveUnavailableAiProvider( 'wpcom' ) ).resolves.toBe( 'anthropic-api-key' );
		await expect( resolveUnavailableAiProvider( 'anthropic-api-key' ) ).resolves.toBeUndefined();
	} );
} );
