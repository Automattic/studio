import {
	AI_BACKEND_PROVIDERS,
	InvalidAiProviderCredentialsError,
} from '@studio/agent/node/providers';
import { persistAiProviderApiKey, readAiProviderApiKey } from '@studio/agent/node/settings-store';
import {
	AI_PROVIDER_IDS,
	DEFAULT_AI_PROVIDER,
	getAiProvider,
	getAiProviderDefaultModel,
	getAiProviderModels,
	type AiProviderId,
} from '@studio/agent/protocol/providers';
import { getStudioUserAgent as buildStudioUserAgent } from '@studio/common/lib/user-agent';
import { __ } from '@wordpress/i18n';
import { runCommand as runLoginCommand } from 'cli/commands/auth/login';
import { openBrowser } from 'cli/lib/browser';
import { password } from 'cli/lib/prompts';
import { LoggerError } from 'cli/logger';
import type { AiModelId } from '@studio/agent/protocol/models';

export const AI_PROVIDERS = Object.fromEntries(
	AI_PROVIDER_IDS.map( ( id ) => [ id, getAiProvider( id ).cliLabel ] )
) as Record< AiProviderId, string >;

export type { AiProviderId };
export { DEFAULT_AI_PROVIDER };
export const AI_PROVIDER_PRIORITY: readonly AiProviderId[] = AI_PROVIDER_IDS;

export interface ResolveAiEnvironmentOptions {
	sessionId?: string;
}

export function getStudioUserAgent(): string {
	return buildStudioUserAgent(
		typeof __STUDIO_CLI_VERSION__ === 'string' ? __STUDIO_CLI_VERSION__ : undefined
	);
}

async function resolveApiKey( provider: AiProviderId, options?: { force?: boolean } ) {
	const { auth } = AI_BACKEND_PROVIDERS[ provider ];
	if ( auth.type !== 'api-key' ) return;
	const savedKey = await readAiProviderApiKey( provider );
	if ( savedKey && ! options?.force ) {
		const validation = await auth.validate( savedKey );
		if ( validation.status !== 'invalid' ) return;
	}
	const key = await password( {
		message: auth.getPrompt(),
		mask: '*',
		validate: async ( value ) => {
			const trimmed = value.trim();
			if ( ! trimmed ) return __( 'API key is required' );
			const validation = await auth.validate( trimmed );
			return validation.status === 'invalid' ? validation.message : true;
		},
	} );
	await persistAiProviderApiKey( provider, key.trim() );
}

export function getAiProviderDefinition( id: AiProviderId ) {
	const backend = AI_BACKEND_PROVIDERS[ id ];
	const { auth } = backend;
	const availableModels = getAiProviderModels( id ).map( ( model ) => model.id );
	const isReady = async () =>
		backend.isPreferred?.() ||
		( auth.type === 'api-key'
			? Boolean( await readAiProviderApiKey( id ) )
			: await auth.isConnected() );
	const resolveEnv = async ( options?: ResolveAiEnvironmentOptions ) => {
		const env = { ...( process.env as Record< string, string > ) };
		for ( const provider of Object.values( AI_BACKEND_PROVIDERS ) ) {
			for ( const key of provider.environmentKeys ) delete env[ key ];
		}
		delete env.OPENAI_API_KEY;
		delete env.OPENAI_BASE_URL;
		try {
			return {
				...env,
				...( await backend.resolveEnv( {
					...options,
					apiKey: auth.type === 'api-key' ? await readAiProviderApiKey( id ) : undefined,
					userAgent: getStudioUserAgent(),
				} ) ),
				STUDIO_AI_PROVIDER: id,
			};
		} catch ( error ) {
			if ( error instanceof InvalidAiProviderCredentialsError ) {
				throw new LoggerError( error.message );
			}
			throw error;
		}
	};
	return {
		id,
		autoFallbackWhenUnavailable: backend.autoFallbackWhenUnavailable,
		isPreferred: backend.isPreferred,
		availableModels,
		defaultModel: getAiProviderDefaultModel( id ),
		supportsModel: ( model: AiModelId ) => availableModels.includes( model ),
		isVisible: async () => true,
		isReady,
		connect:
			auth.type === 'oauth'
				? async () => {
						await auth.login( { openUrl: openBrowser } );
						return true;
				  }
				: backend.connect
				? () => backend.connect!( runLoginCommand )
				: undefined,
		getConnectionMessages: async () =>
			backend.getConnectionMessages?.(
				auth.type === 'api-key' ? await readAiProviderApiKey( id ) : undefined
			),
		getErrorHint: backend.getErrorHint,
		prepare: async ( options?: { force?: boolean } ) => {
			if ( auth.type === 'api-key' ) {
				await resolveApiKey( id, options );
			} else if ( auth.type === 'oauth' ) {
				if ( ! ( await isReady() ) ) {
					throw new LoggerError( __( 'Connect this provider with /provider first.' ) );
				}
			} else if ( ! ( await isReady() ) ) {
				await resolveEnv();
			}
		},
		resolveEnv,
	};
}
