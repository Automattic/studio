import { password } from '@inquirer/prompts';
import { readSelectedAiProvider } from '@studio/common/lib/ai-settings';
import { readProviderConfig, writeProviderConfig } from '@studio/common/lib/provider-config';
import { vi } from 'vitest';
import {
	isAiProviderReady,
	prepareAiProvider,
	resolveAiConnection,
	resolveImageGenerator,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import { LoggerError } from 'cli/logger';

vi.mock( '@inquirer/prompts', () => ( {
	password: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/ai-settings', () => ( {
	readSelectedAiProvider: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/provider-config', () => ( {
	readProviderConfig: vi.fn(),
	writeProviderConfig: vi.fn(),
} ) );

type Configs = { wpcom?: { token: string }; anthropic?: { method: 'api-key'; apiKey: string } };

function storeConfigs( configs: Configs ) {
	vi.mocked( readProviderConfig ).mockImplementation(
		async ( provider ) => configs[ provider ] as never
	);
}

// The key check Anthropic answers; the prompt runs its validation like inquirer.
function answerPrompt( key: string ) {
	vi.mocked( password ).mockImplementation( async ( { validate } ) => {
		await validate?.( key );
		return key;
	} );
}

describe( 'AI auth helpers', () => {
	beforeEach( () => {
		vi.resetAllMocks();
		vi.stubGlobal( '__STUDIO_CLI_VERSION__', '1.2.3' );
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: true, status: 200 } ) );
		vi.stubEnv( 'WPCOM_AI_PROXY_BASE_URL', '' );
		vi.stubEnv( 'STUDIO_WPCOM_TOKEN', '' );
		storeConfigs( {} );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	} );

	it( 'connects Anthropic models with the saved key', async () => {
		storeConfigs( { anthropic: { method: 'api-key', apiKey: 'saved-key' } } );

		await expect( resolveAiConnection( 'anthropic', 'claude-sonnet-5' ) ).resolves.toMatchObject( {
			piProvider: 'anthropic',
			apiKey: 'saved-key',
		} );
	} );

	it( 'requires a saved Anthropic API key', async () => {
		await expect( resolveAiConnection( 'anthropic', 'claude-sonnet-5' ) ).rejects.toBeInstanceOf(
			LoggerError
		);
		expect( password ).not.toHaveBeenCalled();
	} );

	it( 'prompts for the API key when preparing Anthropic without one', async () => {
		answerPrompt( 'prompted-key' );

		await prepareAiProvider( 'anthropic' );

		expect( password ).toHaveBeenCalledOnce();
		expect( writeProviderConfig ).toHaveBeenCalledWith( 'anthropic', {
			method: 'api-key',
			apiKey: 'prompted-key',
		} );
	} );

	it( 'keeps a saved key Anthropic does not reject, and can force re-entering it', async () => {
		storeConfigs( { anthropic: { method: 'api-key', apiKey: 'saved-key' } } );
		answerPrompt( 'updated-key' );

		await prepareAiProvider( 'anthropic' );
		expect( password ).not.toHaveBeenCalled();

		await prepareAiProvider( 'anthropic', { force: true } );
		expect( writeProviderConfig ).toHaveBeenCalledWith( 'anthropic', {
			method: 'api-key',
			apiKey: 'updated-key',
		} );
	} );

	it( 'connects to the WordPress.com gateway with the Studio session headers', async () => {
		storeConfigs( { wpcom: { token: 'wpcom-token' } } );

		const ai = await resolveAiConnection( 'wpcom', 'fast', { sessionId: 'session-abc' } );

		expect( ai.apiKey ).toBe( 'wpcom-token' );
		expect( ai.model.baseUrl ).toBe( 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy/v1' );
		expect( ai.headers ).toEqual( {
			'User-Agent': 'WordPressStudio/1.2.3',
			'X-WPCOM-AI-Feature': 'studio-agent',
			'X-WPCOM-Session-ID': 'session-abc',
		} );
	} );

	it( 'uses STUDIO_WPCOM_TOKEN in place of the Studio sign-in', async () => {
		vi.stubEnv( 'STUDIO_WPCOM_TOKEN', 'inline-token' );
		vi.mocked( readSelectedAiProvider ).mockResolvedValue( 'anthropic' );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'wpcom' );
		await expect( resolveAiConnection( 'wpcom', 'fast' ) ).resolves.toMatchObject( {
			apiKey: 'inline-token',
		} );
	} );

	it( 'prefers the saved provider', async () => {
		vi.mocked( readSelectedAiProvider ).mockResolvedValue( 'anthropic' );
		storeConfigs( { anthropic: { method: 'api-key', apiKey: 'key' } } );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'anthropic' );
	} );

	it( 'defaults to WordPress.com when no provider is saved', async () => {
		await expect( resolveInitialAiProvider() ).resolves.toBe( 'wpcom' );

		storeConfigs( { wpcom: { token: 'wpcom-token' } } );
		await expect( resolveInitialAiProvider() ).resolves.toBe( 'wpcom' );
	} );

	it( 'reports readiness from the provider config', async () => {
		storeConfigs( { wpcom: { token: 'wpcom-token' } } );
		await expect( isAiProviderReady( 'wpcom' ) ).resolves.toBe( true );

		storeConfigs( {} );
		await expect( isAiProviderReady( 'wpcom' ) ).resolves.toBe( false );
	} );

	it( 'resolves a fallback provider only for providers that fall back', async () => {
		storeConfigs( { anthropic: { method: 'api-key', apiKey: 'saved-key' } } );

		await expect( resolveUnavailableAiProvider( 'wpcom' ) ).resolves.toBe( 'anthropic' );
		await expect( resolveUnavailableAiProvider( 'anthropic' ) ).resolves.toBeUndefined();
	} );

	it( 'generates images through WordPress.com whichever provider serves the chat', async () => {
		storeConfigs( { anthropic: { method: 'api-key', apiKey: 'saved-key' } } );
		await expect( resolveImageGenerator() ).resolves.toBeUndefined();

		storeConfigs( { wpcom: { token: 'wpcom-token' } } );
		await expect( resolveImageGenerator() ).resolves.toEqual( expect.any( Function ) );
	} );
} );
