import http from 'http';
import { InvalidCredentialError, type Provider } from '@studio/providers';
import { __ } from '@wordpress/i18n';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = '/auth/callback';

export interface LoopbackSignInOptions {
	openUrl?: ( url: string ) => Promise< unknown > | unknown;
	// Asks for the address the browser landed on, once it is open, for when the
	// redirect can't reach this computer, such as over SSH.
	pasteUrl?: () => Promise< string >;
}

/**
 * Signs in on the provider's site in the browser, listening for its redirect on a free port, and
 * returns what the provider's `connect` takes: the redirect's parameters, the authorization's
 * verifier and the redirect address.
 */
export async function signInThroughLoopback(
	provider: Provider< unknown >,
	{ openUrl, pasteUrl }: LoopbackSignInOptions
): Promise< Record< string, string > > {
	const server = http.createServer();
	try {
		const received = new Promise< URL >( ( resolve ) =>
			server.on( 'request', ( request, response ) => {
				const url = new URL( request.url ?? '/', 'http://127.0.0.1' );
				if ( url.pathname !== CALLBACK_PATH ) {
					response.writeHead( 404 ).end();
					return;
				}
				response
					.writeHead( 200, { 'Content-Type': 'text/plain; charset=utf-8' } )
					.end( __( 'You can close this tab and return to WordPress Studio.' ) );
				resolve( url );
			} )
		);
		await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		const { port } = server.address() as { port: number };
		const redirectUri = `http://127.0.0.1:${ port }${ CALLBACK_PATH }`;
		const authorization = await provider.startLoopbackConnect!( redirectUri );
		await openUrl?.( authorization.url );
		const url = await Promise.race( [
			received,
			...( pasteUrl ? [ pasteUrl().then( ( pasted ) => new URL( pasted.trim() ) ) ] : [] ),
			new Promise< never >( ( _resolve, reject ) =>
				setTimeout(
					() =>
						reject( new InvalidCredentialError( __( 'Signing in took too long. Try again.' ) ) ),
					SIGN_IN_TIMEOUT_MS
				).unref()
			),
		] );
		if ( url.searchParams.get( 'error' ) ) {
			throw new InvalidCredentialError( __( 'Signing in was declined.' ), 'denied' );
		}
		if ( url.searchParams.get( 'state' ) !== authorization.state ) {
			throw new InvalidCredentialError( __( 'That sign-in was for another attempt. Try again.' ) );
		}
		return {
			...Object.fromEntries( url.searchParams ),
			verifier: authorization.verifier,
			redirectUri,
		};
	} finally {
		server.closeAllConnections();
		server.close();
	}
}
