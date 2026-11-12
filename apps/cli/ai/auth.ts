import { connectProvider, readSelectedAiProvider } from '@studio/common/lib/ai-settings';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { getStudioUserAgent as buildStudioUserAgent } from '@studio/common/lib/user-agent';
import {
	DEFAULT_PROVIDER_ID,
	getConnectFields,
	getConnectionMethods,
	getProviderDescriptor,
	InvalidCredentialError,
	AI_PROVIDER_IDS,
	ProviderNotReadyError,
	type AiConnection,
	type AiModelId,
	type ProviderConfigs,
	type AiProviderId,
} from '@studio/providers';
import { getProvider } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { input, password, select } from 'cli/lib/prompts';
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
async function readCliProviderConfig< Id extends AiProviderId >(
	provider: Id
): Promise< ProviderConfigs[ Id ] | undefined > {
	const inlineToken = provider === 'wpcom' ? readInlineWpcomToken() : undefined;
	return inlineToken
		? ( { token: inlineToken } as ProviderConfigs[ Id ] )
		: readProviderConfig( provider );
}

export async function isAiProviderReady( provider: AiProviderId ): Promise< boolean > {
	return ( await readCliProviderConfig( provider ) ) !== undefined;
}

async function getPreferredReadyProvider(
	exclude?: AiProviderId
): Promise< AiProviderId | undefined > {
	for ( const provider of AI_PROVIDER_IDS ) {
		if ( provider !== exclude && ( await isAiProviderReady( provider ) ) ) {
			return provider;
		}
	}
	return undefined;
}

function fallsBackWhenNotReady( provider: AiProviderId ): boolean {
	return getProvider( provider ).ai?.fallbackWhenNotReady ?? false;
}

export async function resolveUnavailableAiProvider(
	provider: AiProviderId
): Promise< AiProviderId | undefined > {
	if ( ( await isAiProviderReady( provider ) ) || ! fallsBackWhenNotReady( provider ) ) {
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
			( await isAiProviderReady( savedProvider ) ) ||
			! fallsBackWhenNotReady( savedProvider )
		) {
			return savedProvider;
		}
		return ( await getPreferredReadyProvider( savedProvider ) ) ?? savedProvider;
	}

	return ( await getPreferredReadyProvider() ) ?? DEFAULT_PROVIDER_ID;
}

// Asks for the fields of a provider that connects with a form, after the method
// when it offers several. The provider checks the values once the last one is
// entered, and a rejection asks again.
async function promptForConnection( provider: AiProviderId ): Promise< void > {
	const methods = getConnectionMethods( provider );
	const method = methods.length
		? await select( {
				message: sprintf(
					/* translators: %s: provider name */
					__( 'How do you want to connect %s?' ),
					getProviderDescriptor( provider ).label
				),
				choices: methods.map( ( { id, label } ) => ( { value: id, name: label() } ) ),
		  } )
		: undefined;
	const fields = getConnectFields( provider, method );
	const values: Record< string, string > = method ? { method } : {};
	for ( const [ index, field ] of fields.entries() ) {
		const prompt = field.secret ? password : input;
		values[ field.name ] = await prompt( {
			message: sprintf(
				/* translators: %s: what the provider asks for, such as an API key */
				__( '%s (saved for future use):' ),
				field.title
			),
			...( field.secret ? { mask: '*' } : {} ),
			validate: async ( value: string ) => {
				const error = field.validate( value );
				if ( error || index < fields.length - 1 ) {
					return error ?? true;
				}
				try {
					await connectProvider( getProvider( provider ), { ...values, [ field.name ]: value } );
					return true;
				} catch ( rejection ) {
					if ( rejection instanceof InvalidCredentialError ) {
						return rejection.message;
					}
					throw rejection;
				}
			},
		} );
	}
}

// Asks for what the provider needs before it is selected.
export async function prepareAiProvider(
	provider: AiProviderId,
	options?: { force?: boolean }
): Promise< void > {
	const ready = await isAiProviderReady( provider );
	if ( getConnectFields( provider ).length ) {
		if ( options?.force || ! ready ) {
			await promptForConnection( provider );
		}
		return;
	}
	if ( ! ready ) {
		throw new LoggerError( __( 'WordPress.com login required. Use /login to authenticate.' ) );
	}
}

async function connect< Id extends AiProviderId >(
	provider: Id,
	model: AiModelId,
	options: { sessionId?: string }
): Promise< AiConnection > {
	const ai = getProvider( provider ).ai;
	if ( ! ai ) {
		throw new LoggerError( `${ getProviderDescriptor( provider ).label } offers no AI models.` );
	}
	const config = await readCliProviderConfig( provider );
	return ai.connect( config, model, options );
}

export async function resolveAiConnection(
	provider: AiProviderId,
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

async function bindImageGenerator< Id extends AiProviderId >(
	provider: Id
): Promise< ImageGenerator | undefined > {
	const generateImages = getProvider( provider ).ai?.generateImages;
	const config = generateImages && ( await readCliProviderConfig( provider ) );
	if ( ! generateImages || ! config ) {
		return undefined;
	}
	return ( requests, onResult ) => generateImages( config, requests, onResult );
}

// Image generation from the first connected provider that offers it, whichever
// provider serves the chat.
export async function resolveImageGenerator(): Promise< ImageGenerator | undefined > {
	for ( const provider of AI_PROVIDER_IDS ) {
		const generator = await bindImageGenerator( provider );
		if ( generator ) {
			return generator;
		}
	}
	return undefined;
}
