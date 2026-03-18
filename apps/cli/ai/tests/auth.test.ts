import childProcess from 'child_process';
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

vi.mock( 'child_process', () => ( {
	default: {
		execFileSync: vi.fn(),
	},
	execFileSync: vi.fn(),
} ) );

vi.mock( '@inquirer/prompts', () => ( {
	password: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: vi.fn(),
} ) );

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn().mockResolvedValue( { version: 1, sites: [] } ),
	updateCliConfigWithPartial: vi.fn(),
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

	it( 'uses Claude auth when the Claude auth provider is selected', async () => {
		vi.mocked( childProcess.execFileSync ).mockReturnValue( 'Authenticated' as never );

		const env = await resolveAiEnvironment( 'anthropic-claude' );

		expect( env.ANTHROPIC_API_KEY ).toBeUndefined();
		expect( password ).not.toHaveBeenCalled();
	} );

	it( 'prompts for the API key immediately when preparing the API key provider', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		vi.mocked( password ).mockResolvedValue( 'prompted-key' );

		await prepareAiProvider( 'anthropic-api-key' );

		expect( password ).toHaveBeenCalledOnce();
		expect( updateCliConfigWithPartial ).toHaveBeenCalledWith( { anthropicApiKey: 'prompted-key' } );
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

	it( 'lists Claude auth only when it is available', async () => {
		vi.mocked( childProcess.execFileSync ).mockReturnValue( 'Authenticated' as never );
		await expect( getAvailableAiProviders() ).resolves.toEqual( [
			'wpcom',
			'anthropic-claude',
			'anthropic-api-key',
		] );

		vi.mocked( childProcess.execFileSync ).mockImplementation( () => {
			throw new Error( 'not authenticated' );
		} );
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

		expect( env.ANTHROPIC_BASE_URL ).toBe(
			'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy'
		);
		expect( env.ANTHROPIC_AUTH_TOKEN ).toBe( 'wpcom-token' );
		expect( env.ANTHROPIC_CUSTOM_HEADERS ).toBe( 'X-WPCOM-AI-Feature: studio-assistant-anthropic' );
		expect( env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS ).toBe( '1' );
		expect( env.ANTHROPIC_API_KEY ).toBeUndefined();
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

	it( 'falls back to API key mode when saved Claude auth is no longer available', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			aiProvider: 'anthropic-claude',
		} );
		vi.mocked( readAuthToken ).mockResolvedValue( null );
		vi.mocked( childProcess.execFileSync ).mockImplementation( () => {
			throw new Error( 'not authenticated' );
		} );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'anthropic-api-key' );
	} );

	it( 'falls back from saved WP.com provider when WordPress.com auth is unavailable and Claude auth is ready', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			aiProvider: 'wpcom',
		} );
		vi.mocked( readAuthToken ).mockResolvedValue( null );
		vi.mocked( childProcess.execFileSync ).mockReturnValue( 'Authenticated' as never );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'anthropic-claude' );
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

	it( 'falls back to Anthropic API key when no other auth is available', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		vi.mocked( readAuthToken ).mockResolvedValue( null );
		vi.mocked( childProcess.execFileSync ).mockImplementation( () => {
			throw new Error( 'not authenticated' );
		} );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'anthropic-api-key' );
	} );

	it( 'defaults to Claude auth when no provider is saved and Claude auth is available', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		vi.mocked( readAuthToken ).mockResolvedValue( null );
		vi.mocked( childProcess.execFileSync ).mockReturnValue( 'Authenticated' as never );

		await expect( resolveInitialAiProvider() ).resolves.toBe( 'anthropic-claude' );
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
