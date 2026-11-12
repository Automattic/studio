import http from 'http';
import {
	InvalidCredentialError,
	type LoopbackAuthorization,
	type Provider,
} from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface LoopbackSignInOptions {
	// Opens the provider's sign-in page in the user's browser.
	openUrl?: ( url: string ) => Promise< unknown > | unknown;
	// Asks for the address the browser landed on, once it is open, for when the
	// redirect can't reach this computer, such as over SSH.
	pasteUrl?: () => Promise< string >;
}

// The sign-in still waiting, and when it has let go of its port.
let pending: { controller: AbortController; settled: Promise< unknown > } | undefined;

// Resolves with the redirect's address once the browser comes back, after `onListening`.
// `closed` resolves once the port is free again, after `signal` aborts.
function listen(
	redirectUri: URL,
	signal: AbortSignal,
	onListening: () => void
): { received: Promise< URL >; closed: Promise< void > } {
	let closed: Promise< void > = Promise.resolve();
	const received = new Promise< URL >( ( resolve, reject ) => {
		const server = http.createServer( ( request, response ) => {
			const url = new URL( request.url ?? '/', redirectUri );
			if ( url.pathname !== redirectUri.pathname ) {
				response.writeHead( 404 ).end();
				return;
			}
			response
				.writeHead( 200, { 'Content-Type': 'text/plain; charset=utf-8' } )
				.end( __( 'You can close this tab and return to WordPress Studio.' ) );
			resolve( url );
		} );
		server.on( 'error', () =>
			reject(
				new InvalidCredentialError(
					sprintf(
						/* translators: %s: a port number */
						__( 'Another app is using port %s, which signing in needs. Close it and try again.' ),
						redirectUri.port
					)
				)
			)
		);
		server.listen( Number( redirectUri.port ), '127.0.0.1', onListening );
		closed = new Promise( ( resolve ) =>
			signal.addEventListener(
				'abort',
				() => {
					server.close( () => resolve() );
					server.closeAllConnections();
				},
				{ once: true }
			)
		);
	} );
	return { received, closed };
}

/**
 * Signs in on the provider's site in the browser, and returns what the provider's `connect` takes:
 * the redirect's parameters and the authorization's verifier. Starting again cancels a sign-in
 * still waiting, which frees its port.
 */
export async function signInThroughLoopback(
	provider: Provider< unknown >,
	options: LoopbackSignInOptions
): Promise< Record< string, string > > {
	const { startLoopbackConnect } = provider;
	if ( ! startLoopbackConnect ) {
		throw new Error( `${ provider.descriptor.id } does not connect with a loopback sign-in` );
	}
	const controller = new AbortController();
	const previous = pending;
	previous?.controller.abort();
	const settled = run( startLoopbackConnect, controller, options, previous?.settled );
	pending = { controller, settled: settled.catch( () => undefined ) };
	try {
		return await settled;
	} finally {
		if ( pending?.controller === controller ) {
			pending = undefined;
		}
	}
}

const canceled = () => new InvalidCredentialError( __( 'Signing in was canceled.' ) );

async function run(
	start: () => Promise< LoopbackAuthorization >,
	controller: AbortController,
	{ openUrl, pasteUrl }: LoopbackSignInOptions,
	previous: Promise< unknown > | undefined
): Promise< Record< string, string > > {
	await previous;
	if ( controller.signal.aborted ) {
		throw canceled();
	}
	const done = new AbortController();
	let closed: Promise< void > | undefined;
	const signal = AbortSignal.any( [
		controller.signal,
		done.signal,
		AbortSignal.timeout( SIGN_IN_TIMEOUT_MS ),
	] );
	try {
		const authorization = await start();
		let listening!: () => void;
		const ready = new Promise< void >( ( resolve ) => ( listening = resolve ) );
		const server = listen( new URL( authorization.redirectUri ), signal, listening );
		closed = server.closed;
		const received = server.received.catch( ( error ) => {
			// Another app may be using the port; the user can still paste the address.
			if ( pasteUrl ) {
				listening();
				return new Promise< never >( () => {} );
			}
			throw error;
		} );
		const stopped = new Promise< never >( ( _resolve, reject ) =>
			signal.addEventListener(
				'abort',
				() =>
					reject(
						controller.signal.aborted
							? canceled()
							: new InvalidCredentialError( __( 'Signing in took too long. Try again.' ) )
					),
				{ once: true }
			)
		);
		stopped.catch( () => undefined );
		await Promise.race( [ ready, received ] );
		await openUrl?.( authorization.url );
		const url = await Promise.race( [
			received,
			stopped,
			...( pasteUrl ? [ pasteUrl().then( ( pasted ) => new URL( pasted.trim() ) ) ] : [] ),
		] );
		if ( url.searchParams.get( 'error' ) ) {
			throw new InvalidCredentialError( __( 'Signing in was declined.' ), 'denied' );
		}
		if ( url.searchParams.get( 'state' ) !== authorization.state ) {
			throw new InvalidCredentialError( __( 'That sign-in was for another attempt. Try again.' ) );
		}
		return { ...Object.fromEntries( url.searchParams ), verifier: authorization.verifier };
	} finally {
		done.abort();
		await closed;
	}
}
