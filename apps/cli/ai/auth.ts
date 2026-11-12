import { connectProvider, readSelectedAiProvider } from '@studio/common/lib/ai-settings';
import { findAgentAppCli } from '@studio/common/lib/connect-agent-app';
import { startCommandSignIn } from '@studio/common/lib/connect-command';
import { readFreshProviderConfig, readProviderConfig } from '@studio/common/lib/provider-config';
import { getStudioUserAgent as buildStudioUserAgent } from '@studio/common/lib/user-agent';
import {
	DEFAULT_PROVIDER_ID,
	getConnectFields,
	getConnection,
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
import { openBrowser } from 'cli/lib/browser';
import { confirm, input, password, select } from 'cli/lib/prompts';
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

// The config to make requests with, renewed first when its credential is about to expire.
async function readUsableProviderConfig< Id extends AiProviderId >(
	provider: Id
): Promise< ProviderConfigs[ Id ] | undefined > {
	return provider === 'wpcom'
		? readCliProviderConfig( provider )
		: readFreshProviderConfig( getProvider( provider ) );
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

// Runs the form's sign-in command, when the user agrees, and connects with the
// code they bring back from the browser. Resolves false when they'd rather type the values.
async function signInWithCommand( provider: AiProviderId, method?: string ): Promise< boolean > {
	const connection = getConnection( provider, method );
	const run = connection.kind === 'form' ? connection.run : undefined;
	if ( ! run || process.platform === 'win32' || ! ( await findAgentAppCli( run.app ) ) ) {
		return false;
	}
	if (
		! ( await confirm( { message: __( 'Sign in through your browser now?' ), default: true } ) )
	) {
		return false;
	}
	const session = await startCommandSignIn( provider, method );
	console.log( __( 'Approve in the browser that opened.' ) );
	if ( session.url ) {
		console.log( sprintf( __( 'If it didn’t open, go to %s' ), session.url ) );
	}
	const code = await input( { message: run.prompt(), validate: ( value ) => !! value.trim() } );
	try {
		await connectProvider( getProvider( provider ), {
			method: method ?? '',
			session: session.id,
			code,
		} );
	} catch ( error ) {
		throw error instanceof InvalidCredentialError ? new LoggerError( error.message ) : error;
	}
	return true;
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
	if ( await signInWithCommand( provider, method ) ) {
		return;
	}
	const connection = getConnection( provider, method );
	const steps = ( connection.kind === 'form' && connection.steps?.() ) || [];
	for ( const [ index, step ] of steps.entries() ) {
		console.log( `${ index + 1 }. ${ step.text }${ step.url ? ` ${ step.url }` : '' }` );
		if ( step.command ) {
			console.log( `   ${ step.command }` );
		}
	}
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

// Signs in in the browser, which comes back to this computer. Over SSH it
// can't, so the user pastes the address the browser lands on instead.
async function signInInBrowser( provider: AiProviderId ): Promise< void > {
	const pasting = new AbortController();
	try {
		await connectProvider(
			getProvider( provider ),
			{},
			{
				openUrl: async ( url ) => {
					console.log(
						sprintf(
							/* translators: %s: a sign-in address */
							__( 'Sign in at %s' ),
							url
						)
					);
					await openBrowser( url ).catch( () => undefined );
				},
				pasteUrl: () =>
					input(
						{
							message: __(
								'Waiting for the browser. If it can’t reach this computer, paste the address it ends on:'
							),
						},
						{ signal: pasting.signal }
					),
			}
		);
	} catch ( error ) {
		throw error instanceof InvalidCredentialError ? new LoggerError( error.message ) : error;
	} finally {
		pasting.abort();
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
	if ( getConnection( provider ).kind === 'loopback' ) {
		if ( options?.force || ! ready ) {
			await signInInBrowser( provider );
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
	return ai.connect( await readUsableProviderConfig( provider ), model, options );
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
