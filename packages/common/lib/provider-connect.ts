import http from 'http';
import {
	ConnectError,
	getConnectMethod,
	type PendingConnect,
	type ProviderId,
	type ProviderServices,
} from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { readSignInContext } from './provider-config';

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PATH = '/auth/callback';

// The redirect each provider's loopback sign-in waits for; starting again replaces it.
const listeners = new Map<
	ProviderId,
	{ id: string; redirect: Promise< URL >; deliver( url: URL ): void; close(): void }
>();

async function listenForRedirect( provider: ProviderId ): Promise< string > {
	listeners.get( provider )?.close();
	const server = http.createServer();
	let deliver!: ( url: URL ) => void;
	let fail!: ( error: Error ) => void;
	const redirect = new Promise< URL >( ( resolve, reject ) => {
		deliver = resolve;
		fail = reject;
	} );
	redirect.catch( () => undefined );
	const id = crypto.randomUUID();
	const close = () => {
		clearTimeout( timeout );
		server.closeAllConnections();
		server.close();
		fail( new ConnectError( __( 'Signing in was started again.' ) ) );
		if ( listeners.get( provider )?.id === id ) {
			listeners.delete( provider );
		}
	};
	const timeout = setTimeout( () => {
		fail( new ConnectError( __( 'Signing in took too long. Try again.' ) ) );
		close();
	}, SIGN_IN_TIMEOUT_MS );
	timeout.unref();
	server.on( 'request', ( request, response ) => {
		const url = new URL( request.url ?? '/', 'http://127.0.0.1' );
		if ( url.pathname !== CALLBACK_PATH ) {
			response.writeHead( 404 ).end();
			return;
		}
		response
			.writeHead( 200, { 'Content-Type': 'text/plain; charset=utf-8' } )
			.end( __( 'You can close this tab and return to WordPress Studio.' ) );
		deliver( url );
	} );
	await new Promise< void >( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
	listeners.set( provider, { id, redirect, deliver, close } );
	const { port } = server.address() as { port: number };
	return `http://127.0.0.1:${ port }${ CALLBACK_PATH }`;
}

/**
 * Starts connecting with a method that signs in on the provider's site: the user goes to the
 * returned `url`, and `connectProvider` takes its `handoff` back. A loopback sign-in listens on a
 * free port of this computer for the redirect until then, for five minutes at most.
 */
export async function startProviderConnect(
	services: ProviderServices,
	method: string
): Promise< PendingConnect > {
	const { id, account } = services;
	if ( ! account.start ) {
		throw new Error( `${ id } connects without signing in on its site` );
	}
	const loopback = getConnectMethod( id, method ).kind === 'loopback';
	const redirectUri = loopback ? await listenForRedirect( id ) : undefined;
	return account.start( method, { ...( await readSignInContext( id ) ), redirectUri } );
}

/**
 * The redirect a loopback sign-in started for, merged into its handoff. Where the browser can't
 * reach this computer, such as over SSH, `pasteUrl` asks for the address it landed on.
 */
export async function receiveRedirect(
	provider: ProviderId,
	handoff: Record< string, string >,
	pasteUrl?: () => Promise< string >
): Promise< Record< string, string > > {
	const listener = listeners.get( provider );
	if ( ! listener ) {
		throw new ConnectError( __( 'Start signing in again.' ) );
	}
	try {
		const url = await Promise.race( [
			listener.redirect,
			...( pasteUrl ? [ pasteUrl().then( ( pasted ) => new URL( pasted.trim() ) ) ] : [] ),
		] );
		if ( url.searchParams.get( 'error' ) ) {
			throw new ConnectError( __( 'Signing in was declined.' ), 'denied' );
		}
		if ( handoff.state && url.searchParams.get( 'state' ) !== handoff.state ) {
			throw new ConnectError( __( 'That sign-in was for another attempt. Try again.' ) );
		}
		return { ...handoff, ...Object.fromEntries( url.searchParams ) };
	} finally {
		listener.close();
	}
}
