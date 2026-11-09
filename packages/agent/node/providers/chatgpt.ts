import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
import { __ } from '@wordpress/i18n';
import type { AiProvider } from './types';
import type { CredentialStore } from '@earendil-works/pi-ai';

export const CHATGPT_PI_PROVIDER = 'openai';

export function createChatGptProvider( credentials: CredentialStore ) {
	const subscriptionCredentials: CredentialStore = {
		async read( id ) {
			if ( id !== CHATGPT_PI_PROVIDER ) return undefined;
			const credential = await credentials.read( id );
			if ( credential?.type !== 'oauth' ) throw new Error( __( 'Sign in with ChatGPT first.' ) );
			return credential;
		},
		list: async () =>
			( await credentials.list() ).filter(
				( entry ) => entry.providerId === CHATGPT_PI_PROVIDER && entry.type === 'oauth'
			),
		modify: ( id, update ) =>
			credentials.modify( id, async ( current ) => {
				if ( id !== CHATGPT_PI_PROVIDER || current?.type !== 'oauth' ) {
					throw new Error( __( 'Sign in with ChatGPT first.' ) );
				}
				return update( current );
			} ),
		delete: ( id ) => credentials.delete( id ),
	};
	return {
		auth: { type: 'oauth' },
		buildModel( modelId ) {
			const model = Object.values( OPENAI_MODELS ).find( ( entry ) => entry.id === modelId );
			if ( ! model ) throw new Error( `No ChatGPT model found for ${ modelId }.` );
			return { ...model, contextWindow: Math.min( model.contextWindow, 200_000 ) };
		},
		async createRuntime() {
			// Never fall back to an ambient API key and charge a different account.
			if ( ( await credentials.read( CHATGPT_PI_PROVIDER ) )?.type !== 'oauth' ) {
				throw new Error( __( 'Sign in with ChatGPT first.' ) );
			}
			const { ModelRuntime } = await import( '@earendil-works/pi-coding-agent' );
			return ModelRuntime.create( { credentials: subscriptionCredentials, modelsPath: null } );
		},
		async configureRuntime( runtime, model ) {
			await runtime.getAuth( model );
		},
	} satisfies AiProvider;
}

export async function signInWithChatGpt( options: {
	credentials: CredentialStore;
	deviceId: string;
	openUrl: ( url: string ) => Promise< void > | void;
	signal?: AbortSignal;
} ): Promise< void > {
	const signal = AbortSignal.any( [
		AbortSignal.timeout( 5 * 60_000 ),
		...( options.signal ? [ options.signal ] : [] ),
	] );
	const { ModelRuntime } = await import( '@earendil-works/pi-coding-agent' );
	const runtime = await ModelRuntime.create( {
		credentials: options.credentials,
		modelsPath: null,
		refreshOnCreate: false,
	} );
	const browserFailure = new AbortController();
	const loginSignal = AbortSignal.any( [ signal, browserFailure.signal ] );
	await runtime.login(
		CHATGPT_PI_PROVIDER,
		'oauth',
		{
			signal: loginSignal,
			notify: ( event ) => {
				if ( event.type === 'auth_url' ) {
					void Promise.resolve()
						.then( () => options.openUrl( event.url ) )
						.catch( ( error ) => browserFailure.abort( error ) );
				}
			},
			prompt: ( prompt ) =>
				new Promise( ( _resolve, reject ) => {
					const promptSignal = prompt.signal ?? loginSignal;
					if ( promptSignal.aborted ) {
						reject( promptSignal.reason );
						return;
					}
					promptSignal.addEventListener( 'abort', () => reject( promptSignal.reason ), {
						once: true,
					} );
				} ),
		},
		{ getDeviceId: () => options.deviceId, agentName: 'WordPress Studio' }
	);
}
