import http from 'http';
import { InvalidCredentialError, type Provider } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface LoopbackSignInOptions {
	openUrl?: ( url: string ) => Promise< unknown > | unknown;
	// Asks for the address the browser landed on, once it is open, for when the
	// redirect can't reach this computer, such as over SSH.
	pasteUrl?: () => Promise< string >;
}

// The sign-in still waiting, and when it has let go of its port.
let pending: { cancel: AbortController; done: Promise< unknown > } | undefined;

/**
 * Signs in on the provider's site in the browser, and returns what the provider's `connect` takes:
 * the redirect's parameters and the authorization's verifier. Starting again cancels a sign-in
 * still waiting.
 */
export async function signInThroughLoopback(
	provider: Provider< unknown >,
	{ openUrl, pasteUrl }: LoopbackSignInOptions
): Promise< Record< string, string > > {
	const previous = pending;
	const cancel = new AbortController();
	previous?.cancel.abort();
	const signIn = ( async () => {
		await previous?.done;
		const signal = AbortSignal.any( [ cancel.signal, AbortSignal.timeout( SIGN_IN_TIMEOUT_MS ) ] );
		const stopped = new Promise< never >( ( _resolve, reject ) => {
			const stop = () =>
				reject(
					new InvalidCredentialError(
						cancel.signal.aborted
							? __( 'Signing in was canceled.' )
							: __( 'Signing in took too long. Try again.' )
					)
				);
			if ( signal.aborted ) {
				stop();
			}
			signal.addEventListener( 'abort', stop, { once: true } );
		} );
		stopped.catch( () => undefined );

		const authorization = await provider.startLoopbackConnect!();
		const redirectUri = new URL( authorization.redirectUri );
		const server = http.createServer();
		try {
			const received = new Promise< URL >( ( resolve ) =>
				server.on( 'request', ( request, response ) => {
					const url = new URL( request.url ?? '/', redirectUri );
					if ( url.pathname !== redirectUri.pathname ) {
						response.writeHead( 404 ).end();
						return;
					}
					response
						.writeHead( 200, { 'Content-Type': 'text/plain; charset=utf-8' } )
						.end( __( 'You can close this tab and return to WordPress Studio.' ) );
					resolve( url );
				} )
			);
			const listening = await new Promise< boolean >( ( resolve ) => {
				server.once( 'listening', () => resolve( true ) );
				server.once( 'error', () => resolve( false ) );
				server.listen( Number( redirectUri.port ), '127.0.0.1' );
			} );
			// Another app may be using the port; the user can still paste the address.
			if ( ! listening && ! pasteUrl ) {
				throw new InvalidCredentialError(
					sprintf(
						/* translators: %s: a port number */
						__( 'Another app is using port %s, which signing in needs. Close it and try again.' ),
						redirectUri.port
					)
				);
			}
			await openUrl?.( authorization.url );
			const url = await Promise.race( [
				stopped,
				...( listening ? [ received ] : [] ),
				...( pasteUrl ? [ pasteUrl().then( ( pasted ) => new URL( pasted.trim() ) ) ] : [] ),
			] );
			if ( url.searchParams.get( 'error' ) ) {
				throw new InvalidCredentialError( __( 'Signing in was declined.' ), 'denied' );
			}
			if ( url.searchParams.get( 'state' ) !== authorization.state ) {
				throw new InvalidCredentialError(
					__( 'That sign-in was for another attempt. Try again.' )
				);
			}
			return { ...Object.fromEntries( url.searchParams ), verifier: authorization.verifier };
		} finally {
			server.closeAllConnections();
			await new Promise( ( resolve ) => server.close( resolve ) );
		}
	} )();
	pending = { cancel, done: signIn.catch( () => undefined ) };
	try {
		return await signIn;
	} finally {
		if ( pending?.cancel === cancel ) {
			pending = undefined;
		}
	}
}
