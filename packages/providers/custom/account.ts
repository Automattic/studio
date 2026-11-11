import { normalizeContext, type Model } from '@earendil-works/pi-ai';
import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { __, sprintf } from '@wordpress/i18n';
import { InvalidCredentialError } from '../errors';
import { customConnection } from './ai';
import { customConnectInput } from './descriptor';
import type { CustomConfig } from './config';
import type { Provider } from '../types';

// The APIs an endpoint may speak, in the order connecting tries them: Chat
// Completions first, as nearly every gateway and local server takes it. Each
// is given the URL as the user entered it, except that Anthropic Messages
// appends `/v1/messages` itself.
const APIS: ReadonlyArray< { api: CustomConfig[ 'api' ]; baseUrl: ( url: string ) => string } > = [
	{ api: 'openai-completions', baseUrl: ( url ) => url },
	{ api: 'anthropic-messages', baseUrl: ( url ) => url.replace( /\/v1$/, '' ) },
];

const CHECK_TIMEOUT_MS = 30_000;

// Sends the model a short request the way a turn does. Undefined when it
// answers; otherwise the error it gave.
async function check( config: CustomConfig ): Promise< string | undefined > {
	const { model, apiKey } = customConnection( config );
	const stream = (
		config.api === 'openai-completions' ? streamOpenAiCompletions : streamAnthropicMessages
	) as typeof streamOpenAiCompletions;
	const reply = await stream(
		{ ...model, id: config.model } as Model< 'openai-completions' >,
		normalizeContext( {
			messages: [ { role: 'user', content: 'Reply with: ok', timestamp: Date.now() } ],
		} ),
		{ apiKey, maxTokens: 16, signal: AbortSignal.timeout( CHECK_TIMEOUT_MS ) }
	).result();
	return reply.stopReason === 'error' || reply.stopReason === 'aborted'
		? reply.errorMessage ?? 'The request failed.'
		: undefined;
}

// Tries each API until the model answers in one; only a connection that
// answers is saved, with the API it answered in.
export const connectCustom: Provider< CustomConfig >[ 'connect' ] = async ( input ) => {
	const parsed = customConnectInput().safeParse( input );
	if ( ! parsed.success ) {
		throw new InvalidCredentialError( parsed.error.issues[ 0 ].message );
	}
	const { url, apiKey, model, images } = parsed.data;
	const failures: string[] = [];
	for ( const candidate of APIS ) {
		const config: CustomConfig = {
			baseUrl: candidate.baseUrl( url.replace( /\/+$/, '' ) ),
			api: candidate.api,
			apiKey,
			model,
			images: images === 'yes',
		};
		const failure = await check( config );
		if ( ! failure ) {
			return config;
		}
		failures.push( failure );
	}
	throw new InvalidCredentialError(
		sprintf(
			/* translators: 1: the model's name, 2: what the endpoint answered in each API */
			__( 'The endpoint did not answer for %1$s, so it was not saved: %2$s' ),
			model,
			failures.join( ' / ' )
		)
	);
};
