import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { __ } from '@wordpress/i18n';
import {
	CHATGPT_PI_PROVIDER,
	FileCredentialStore,
	getOrCreateDeviceId,
} from '@studio/agent/node/credential-store';

/**
 * Sign in with ChatGPT lets a ChatGPT Plus or Pro plan pay for Studio Code's
 * requests. pi owns the flow: the browser sign-in, token refresh, and the
 * narrower Responses API the plan's tokens accept. Studio supplies the
 * credential store and the install's identity.
 * https://developers.openai.com/siwc/token-sharing-open-source
 *
 * pi only ships with the CLI, so the apps sign in through `studio code
 * chatgpt login` rather than importing this module.
 */

const AGENT_NAME = 'WordPress Studio';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

// One sign-in at a time per process: starting another cancels the one still
// waiting for the browser.
let activeSignIn: AbortController | undefined;

export interface ChatGptSignInOptions {
	/** Opens the sign-in page in the user's browser. */
	openUrl( url: string ): Promise< void > | void;
	signal?: AbortSignal;
}

/**
 * Runs the browser sign-in and saves the account. Resolves once the user
 * approves in the browser; rejects on cancel, timeout, or an account whose
 * plan can't be shared.
 */
export async function signInWithChatGpt( options: ChatGptSignInOptions ): Promise< void > {
	activeSignIn?.abort();
	const controller = new AbortController();
	activeSignIn = controller;
	const timeout = AbortSignal.timeout( SIGN_IN_TIMEOUT_MS );
	const signal = AbortSignal.any( [
		controller.signal,
		timeout,
		...( options.signal ? [ options.signal ] : [] ),
	] );

	try {
		const [ runtime, deviceId ] = await Promise.all( [
			ModelRuntime.create( {
				credentials: new FileCredentialStore(),
				modelsPath: null,
				refreshOnCreate: false,
			} ),
			getOrCreateDeviceId(),
		] );
		await runtime.login(
			CHATGPT_PI_PROVIDER,
			'oauth',
			{
				signal,
				notify: ( event ) => {
					if ( event.type === 'auth_url' ) {
						void Promise.resolve( options.openUrl( event.url ) ).catch( ( error ) =>
							console.warn( '[chatgpt-auth] Could not open the sign-in page:', error )
						);
					}
				},
				// The browser callback completes the sign-in. pi also offers to take a
				// pasted callback URL; Studio has no field for one, so this prompt
				// waits until pi withdraws it.
				prompt: ( prompt ) =>
					new Promise( ( _resolve, reject ) => {
						const promptSignal = prompt.signal ?? signal;
						const onAbort = () => reject( promptSignal.reason );
						if ( promptSignal.aborted ) {
							onAbort();
						}
						promptSignal.addEventListener( 'abort', onAbort, { once: true } );
					} ),
			},
			{ getDeviceId: () => deviceId, agentName: AGENT_NAME }
		);
	} catch ( error ) {
		if ( timeout.aborted ) {
			throw new Error( __( 'ChatGPT sign-in timed out. Try again.' ) );
		}
		if ( signal.aborted ) {
			throw new Error( __( 'ChatGPT sign-in was cancelled.' ) );
		}
		throw error;
	} finally {
		if ( activeSignIn === controller ) {
			activeSignIn = undefined;
		}
	}
}
