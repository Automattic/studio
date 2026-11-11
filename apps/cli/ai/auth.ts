import { readSelectedAiProvider } from '@studio/common/lib/ai-settings';
import { readProviderConfig, writeProviderConfig } from '@studio/common/lib/provider-config';
import { getStudioUserAgent as buildStudioUserAgent } from '@studio/common/lib/user-agent';
import {
	DEFAULT_PROVIDER_ID,
	getProviderDescriptor,
	InvalidCredentialError,
	PROVIDER_IDS,
	ProviderNotReadyError,
	type AiConnection,
	type AiModelId,
	type ProviderConfigs,
	type ProviderId,
} from '@studio/providers';
import { getProvider } from '@studio/providers/node';
import { __ } from '@wordpress/i18n';
import { password } from 'cli/lib/prompts';
import { LoggerError } from 'cli/logger';
import type { ImageGenerator } from '@studio/agent/node';

export function getStudioUserAgent(): string {
	return buildStudioUserAgent(
		typeof __STUDIO_CLI_VERSION__ === 'string' ? __STUDIO_CLI_VERSION__ : undefined
	);
}

function readInlineWpcomToken(): string | undefined {
	return process.env.STUDIO_WPCOM_TOKEN?.trim() || undefined;
}

// `STUDIO_WPCOM_TOKEN` stands in for the Studio sign-in.
async function readCliProviderConfig< Id extends ProviderId >(
	provider: Id
): Promise< ProviderConfigs[ Id ] | undefined > {
	const inlineToken = provider === 'wpcom' ? readInlineWpcomToken() : undefined;
	return inlineToken
		? ( { token: inlineToken } as ProviderConfigs[ Id ] )
		: readProviderConfig( provider );
}

export async function isAiProviderReady( provider: ProviderId ): Promise< boolean > {
	return ( await readCliProviderConfig( provider ) ) !== undefined;
}

async function getPreferredReadyProvider(
	exclude?: ProviderId
): Promise< ProviderId | undefined > {
	for ( const provider of PROVIDER_IDS ) {
		if ( provider !== exclude && ( await isAiProviderReady( provider ) ) ) {
			return provider;
		}
	}
	return undefined;
}

function fallsBackWhenNotReady( provider: ProviderId ): boolean {
	return getProvider( provider ).ai?.fallbackWhenNotReady ?? false;
}

export async function resolveUnavailableAiProvider(
	provider: ProviderId
): Promise< ProviderId | undefined > {
	if ( ( await isAiProviderReady( provider ) ) || ! fallsBackWhenNotReady( provider ) ) {
		return undefined;
	}
	return getPreferredReadyProvider( provider );
}

export async function resolveInitialAiProvider(): Promise< ProviderId > {
	if ( readInlineWpcomToken() ) {
		return 'wpcom';
	}

	const savedProvider = await readSelectedAiProvider();
	if ( savedProvider ) {
		if (
			( await isAiProviderReady( savedProvider ) ) ||
			! fallsBackWhenNotReady( savedProvider )
		) {
			return savedProvider;
		}
		return ( await getPreferredReadyProvider( savedProvider ) ) ?? savedProvider;
	}

	return ( await getPreferredReadyProvider() ) ?? DEFAULT_PROVIDER_ID;
}

// Re-prompts only when Anthropic definitively rejects the saved key: an
// unreachable API must not lock the user out of their provider.
async function promptForAnthropicApiKey( options?: { force?: boolean } ): Promise< void > {
	const { account } = getProvider( 'anthropic' );
	const saved = await readProviderConfig( 'anthropic' );
	if ( saved && ! options?.force ) {
		try {
			await account.connectApiKey!( saved.apiKey );
			return;
		} catch ( error ) {
			if ( ! ( error instanceof InvalidCredentialError ) ) {
				throw error;
			}
		}
	}

	let config: ProviderConfigs[ 'anthropic' ] | undefined;
	const key = await password( {
		message: __( 'Enter your Anthropic API key (will be saved for future use):' ),
		mask: '*',
		validate: async ( value ) => {
			try {
				config = await account.connectApiKey!( value );
				return true;
			} catch ( error ) {
				if ( error instanceof InvalidCredentialError ) {
					return error.message;
				}
				throw error;
			}
		},
	} );
	await writeProviderConfig( 'anthropic', config ?? ( await account.connectApiKey!( key ) ) );
}

// Asks for what the provider needs before it is selected.
export async function prepareAiProvider(
	provider: ProviderId,
	options?: { force?: boolean }
): Promise< void > {
	if ( provider === 'anthropic' ) {
		await promptForAnthropicApiKey( options );
		return;
	}
	if ( ! ( await isAiProviderReady( provider ) ) ) {
		throw new LoggerError( __( 'WordPress.com login required. Use /login to authenticate.' ) );
	}
}

async function connect< Id extends ProviderId >(
	provider: Id,
	model: AiModelId,
	options: { sessionId?: string }
): Promise< AiConnection > {
	const ai = getProvider( provider ).ai;
	if ( ! ai ) {
		throw new LoggerError( `${ getProviderDescriptor( provider ).label } offers no AI models.` );
	}
	const config = await readCliProviderConfig( provider );
	return ai.connect( { config, userAgent: getStudioUserAgent() }, model, options );
}

export async function resolveAiConnection(
	provider: ProviderId,
	model: AiModelId,
	options: { sessionId?: string } = {}
): Promise< AiConnection > {
	try {
		return await connect( provider, model, options );
	} catch ( error ) {
		if ( error instanceof ProviderNotReadyError ) {
			throw new LoggerError( error.message );
		}
		throw error;
	}
}

async function bindImageGenerator< Id extends ProviderId >(
	provider: Id
): Promise< ImageGenerator | undefined > {
	const generateImages = getProvider( provider ).ai?.generateImages;
	const config = generateImages && ( await readCliProviderConfig( provider ) );
	if ( ! generateImages || ! config ) {
		return undefined;
	}
	const context = { config, userAgent: getStudioUserAgent() };
	return ( requests, onResult ) => generateImages( context, requests, onResult );
}

// Image generation from the first connected provider that offers it, whichever
// provider serves the chat.
export async function resolveImageGenerator(): Promise< ImageGenerator | undefined > {
	for ( const provider of PROVIDER_IDS ) {
		const generator = await bindImageGenerator( provider );
		if ( generator ) {
			return generator;
		}
	}
	return undefined;
}
