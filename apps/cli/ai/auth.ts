import { readSelectedAiProvider } from '@studio/common/lib/ai-settings';
import { readFreshProviderConfig } from '@studio/common/lib/provider-config';
import { getStudioUserAgent as buildStudioUserAgent } from '@studio/common/lib/user-agent';
import {
	AI_PROVIDER_IDS,
	DEFAULT_PROVIDER_ID,
	getProvider,
	NotConnectedError,
	type AiConnection,
	type AiModelId,
	type AiProviderId,
	type ProviderConfigs,
	type ProviderId,
} from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { isProviderConnected, readInlineConfig, readInlineWpcomToken } from 'cli/lib/providers';
import { LoggerError } from 'cli/logger';
import type { ImageGenerator } from '@studio/agent/node';

export function getStudioUserAgent(): string {
	return buildStudioUserAgent(
		typeof __STUDIO_CLI_VERSION__ === 'string' ? __STUDIO_CLI_VERSION__ : undefined
	);
}

// The config to make requests with, renewed first when its credential is about to expire.
async function readUsableProviderConfig< Id extends ProviderId >(
	provider: Id
): Promise< ProviderConfigs[ Id ] | undefined > {
	return (
		readInlineConfig( provider ) ??
		( ( await readFreshProviderConfig( getProviderServices( provider ) ) ) as
			| ProviderConfigs[ Id ]
			| undefined )
	);
}

async function getPreferredReadyProvider(
	exclude?: AiProviderId
): Promise< AiProviderId | undefined > {
	for ( const provider of AI_PROVIDER_IDS ) {
		if ( provider !== exclude && ( await isProviderConnected( provider ) ) ) {
			return provider;
		}
	}
	return undefined;
}

// The default provider is the Studio sign-in: signing out of Studio leaves its chats to another
// connected provider. A provider the user picked asks to be connected again instead.
function fallsBackWhenNotReady( provider: AiProviderId ): boolean {
	return provider === DEFAULT_PROVIDER_ID;
}

export async function resolveUnavailableAiProvider(
	provider: AiProviderId
): Promise< AiProviderId | undefined > {
	if ( ( await isProviderConnected( provider ) ) || ! fallsBackWhenNotReady( provider ) ) {
		return undefined;
	}
	return getPreferredReadyProvider( provider );
}

export async function resolveInitialAiProvider(): Promise< AiProviderId > {
	if ( readInlineWpcomToken() ) {
		return 'wpcom';
	}

	const savedProvider = await readSelectedAiProvider();
	if ( savedProvider ) {
		if (
			( await isProviderConnected( savedProvider ) ) ||
			! fallsBackWhenNotReady( savedProvider )
		) {
			return savedProvider;
		}
		return ( await getPreferredReadyProvider( savedProvider ) ) ?? savedProvider;
	}

	return ( await getPreferredReadyProvider() ) ?? DEFAULT_PROVIDER_ID;
}

async function connect< Id extends AiProviderId >(
	provider: Id,
	model: AiModelId,
	options: { sessionId?: string }
): Promise< AiConnection > {
	const ai = getProviderServices( provider ).ai;
	if ( ! ai ) {
		throw new LoggerError( `${ getProvider( provider ).label } offers no AI models.` );
	}
	return ai.model( await readUsableProviderConfig( provider ), model, options );
}

export async function resolveAiConnection(
	provider: AiProviderId,
	model: AiModelId,
	options: { sessionId?: string } = {}
): Promise< AiConnection > {
	try {
		return await connect( provider, model, options );
	} catch ( error ) {
		if ( error instanceof NotConnectedError ) {
			throw new LoggerError(
				sprintf(
					/* translators: 1: why the provider can't be used, 2: a provider id such as anthropic */
					__( '%1$s Use /connect %2$s to connect it.' ),
					error.message,
					provider
				)
			);
		}
		throw error;
	}
}

async function bindImageGenerator< Id extends AiProviderId >(
	provider: Id
): Promise< ImageGenerator | undefined > {
	const generateImages = getProviderServices( provider ).ai?.generateImages;
	const config = generateImages && ( await readUsableProviderConfig( provider ) );
	if ( ! generateImages || ! config ) {
		return undefined;
	}
	return ( requests, onResult ) => generateImages( config, requests, onResult );
}

// Image generation from the chat's provider when it offers it, otherwise from the
// first connected provider that does.
export async function resolveImageGenerator(
	chatProvider?: AiProviderId
): Promise< ImageGenerator | undefined > {
	const providers = chatProvider
		? [ chatProvider, ...AI_PROVIDER_IDS.filter( ( id ) => id !== chatProvider ) ]
		: AI_PROVIDER_IDS;
	for ( const provider of providers ) {
		const generator = await bindImageGenerator( provider );
		if ( generator ) {
			return generator;
		}
	}
	return undefined;
}
