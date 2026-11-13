import { password, select } from '@inquirer/prompts';
import { connectProvider, readSelectedAiProvider } from '@studio/common/lib/ai-settings';
import { readFreshProviderConfig, readProviderConfig } from '@studio/common/lib/provider-config';
import { ConnectError, type ProviderId } from '@studio/providers';
import { vi } from 'vitest';
import {
	resolveAiConnection,
	resolveImageGenerator,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import { connectInTerminal, isProviderConnected } from 'cli/lib/providers';
import { LoggerError } from 'cli/logger';

vi.mock( '@inquirer/prompts', () => ( {
	password: vi.fn(),
	select: vi.fn(),
} ) );

vi.mock( 'cli/commands/auth/login', () => ( { runCommand: vi.fn() } ) );

vi.mock( '@studio/common/lib/ai-settings', () => ( {
	connectProvider: vi.fn(),
	readSelectedAiProvider: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/provider-config', () => ( {
	readFreshProviderConfig: vi.fn(),
	readProviderConfig: vi.fn(),
} ) );

const anthropicProvider = expect.objectContaining( { id: 'anthropic' } );

type Configs = Partial< Record< ProviderId, object > >;

function storeConfigs( configs: Configs ) {
	vi.mocked( readProviderConfig ).mockImplementation(
		async ( provider ) => configs[ provider as keyof Configs ] as never
	);
	vi.mocked( readFreshProviderConfig ).mockImplementation(
		async ( provider ) => configs[ provider.id ] as never
	);
}

// The prompt runs its validation like inquirer, and reports what it returned.
const validations: unknown[] = [];
function answerPrompt( key: string ) {
	vi.mocked( password ).mockImplementation( async ( { validate } ) => {
		validations.push( await validate?.( key ) );
		return key;
	} );
}

describe( 'AI auth helpers', () => {
	beforeEach( () => {
		vi.resetAllMocks();
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( { ok: true, status: 200 } ) );
		vi.stubEnv( 'WPCOM_AI_PROXY_BASE_URL', '' );
		vi.stubEnv( 'STUDIO_WPCOM_TOKEN', '' );
		storeConfigs( {} );
		vi.mocked( select ).mockResolvedValue( 'api-key' );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	} );

	it( 'connects Anthropic models with the saved key', async () => {
		storeConfigs( { anthropic: { method: 'api-key', apiKey: 'saved-key' } } );

		await expect( resolveAiConnection( 'anthropic', 'claude-sonnet-5-5' ) ).resolves.toMatchObject(
			{
				piProvider: 'anthropic',
				apiKey: 'saved-key',
			}
		);
	} );

	it( 'requires a saved Anthropic API key', async () => {
		await expect( resolveAiConnection( 'anthropic', 'claude-sonnet-5-5' ) ).rejects.toBeInstanceOf(
			LoggerError
		);
		expect( password ).not.toHaveBeenCalled();
	} );

	it( 'prompts for the API key when preparing Anthropic without one', async () => {
		answerPrompt( 'prompted-key' );

		await connectInTerminal( 'anthropic' );

		expect( password ).toHaveBeenCalledOnce();
		expect( connectProvider ).toHaveBeenCalledWith( anthropicProvider, 'api-key', {
			apiKey: 'prompted-key',
		} );
	} );

	it( 'asks how to connect, then for the chosen method’s fields', async () => {
		vi.mocked( select ).mockResolvedValue( 'setup-token' );
		answerPrompt( 'sk-ant-oat01-token' );

		await connectInTerminal( 'anthropic' );

		expect( connectProvider ).toHaveBeenCalledWith( anthropicProvider, 'setup-token', {
			token: 'sk-ant-oat01-token',
		} );

		vi.mocked( select ).mockResolvedValue( 'api-key' );
		answerPrompt( 'sk-proj-key' );

		await connectInTerminal( 'openai' );

		expect( connectProvider ).toHaveBeenLastCalledWith(
			expect.objectContaining( { id: 'openai' } ),
			'api-key',
			{ apiKey: 'sk-proj-key' }
		);
	} );

	it( 'shows the provider’s rejection as the prompt’s error', async () => {
		vi.mocked( connectProvider ).mockRejectedValue( new ConnectError( 'Rejected key' ) );
		answerPrompt( 'bad-key' );

		await connectInTerminal( 'anthropic' );

		expect( validations.at( -1 ) ).toBe( 'Rejected key' );
	} );

	it( 'keeps a saved key, and can force re-entering it', async () => {
		storeConfigs( { anthropic: { method: 'api-key', apiKey: 'saved-key' } } );
		answerPrompt( 'updated-key' );

		await connectInTerminal( 'anthropic' );
		expect( password ).not.toHaveBeenCalled();

		await connectInTerminal( 'anthropic', { force: true } );
		expect( connectProvider ).toHaveBeenCalledWith( anthropicProvider, 'api-key', {
			apiKey: 'updated-key',
		} );
	} );

	it( 'connects WordPress.com by signing in to Studio', async () => {
		const { runCommand: login } = await import( 'cli/commands/auth/login' );

		await connectInTerminal( 'wpcom' );

		expect( login ).toHaveBeenCalledOnce();
		expect( connectProvider ).not.toHaveBeenCalled();
	} );

	it( 'connects to the WordPress.com gateway with the Studio session headers', async () => {
		storeConfigs( { wpcom: { token: 'wpcom-token' } } );

		const ai = await resolveAiConnection( 'wpcom', 'fast', { sessionId: 'session-abc' } );

		expect( ai.apiKey ).toBe( 'wpcom-token' );
		expect( ai.model.baseUrl ).toBe( 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy/v1' );
		expect( ai.headers ).toEqual( {
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
		await expect( isProviderConnected( 'wpcom' ) ).resolves.toBe( true );

		storeConfigs( {} );
		await expect( isProviderConnected( 'wpcom' ) ).resolves.toBe( false );
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

	it( 'generates images through OpenAI for its chats with an API key, not a ChatGPT plan', async () => {
		vi.mocked( fetch ).mockImplementation( async () => new Response( '{}', { status: 400 } ) );
		const generated = async () => {
			const generate = await resolveImageGenerator( 'openai' );
			await generate!( [ { prompt: 'A lake' } ] );
			return String( vi.mocked( fetch ).mock.lastCall![ 0 ] );
		};

		storeConfigs( {
			wpcom: { token: 'wpcom-token' },
			openai: { method: 'api-key', apiKey: 'sk-key' },
		} );
		await expect( generated() ).resolves.toBe( 'https://api.openai.com/v1/images/generations' );

		storeConfigs( {
			wpcom: { token: 'wpcom-token' },
			openai: { method: 'chatgpt', accessToken: 'access' },
		} );
		await expect( generated() ).resolves.toContain( 'public-api.wordpress.com' );
	} );
} );
