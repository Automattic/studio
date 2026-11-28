import { __ } from '@wordpress/i18n';
import type { TailscaleState } from './tailscale';

// How a phone reaches remote mode. In the order Automatic tries them: the
// safest one that is ready wins.
export const REMOTE_CONNECTION_KINDS = [ 'https', 'tailnet', 'local' ] as const;
export type RemoteConnectionKind = ( typeof REMOTE_CONNECTION_KINDS )[ number ];

export const REMOTE_CONNECTION_REQUESTS = [ 'auto', ...REMOTE_CONNECTION_KINDS ] as const;
export type RemoteConnectionRequest = ( typeof REMOTE_CONNECTION_REQUESTS )[ number ];

// What a connection still needs before it can run.
export type RemoteConnectionMissing =
	| 'tailscale'
	| 'tailscale-sign-in'
	| 'tailscale-https'
	| 'network';

export interface RemoteConnectionInputs {
	tailscale: TailscaleState;
	// The local network address: `getDefaultLanAddress()`, or `--host`.
	lanAddress: string | undefined;
}

export type RemoteConnectionChoice =
	| {
			ok: true;
			kind: RemoteConnectionKind;
			// The address remote mode listens on.
			host: string;
			// The address phones use, in the record and the QR code.
			url: ( port: number ) => string;
	  }
	| { ok: false; kind: RemoteConnectionKind; missing: RemoteConnectionMissing };

export type ReadyRemoteConnection = Extract< RemoteConnectionChoice, { ok: true } >;

export function isRemoteConnectionRequest( value: unknown ): value is RemoteConnectionRequest {
	return ( REMOTE_CONNECTION_REQUESTS as readonly unknown[] ).includes( value );
}

export function missingForConnection(
	kind: RemoteConnectionKind,
	{ tailscale, lanAddress }: RemoteConnectionInputs
): RemoteConnectionMissing | undefined {
	if ( kind === 'local' ) {
		return lanAddress ? undefined : 'network';
	}
	if ( ! tailscale.installed ) {
		return 'tailscale';
	}
	if ( ! tailscale.running || ( kind === 'tailnet' && ! tailscale.ipv4 ) ) {
		return 'tailscale-sign-in';
	}
	if ( kind === 'https' && ! ( tailscale.dnsName && tailscale.httpsReady ) ) {
		return 'tailscale-https';
	}
	return undefined;
}

function urlHost( host: string ): string {
	return host.includes( ':' ) ? `[${ host }]` : host;
}

function readyChoice(
	kind: RemoteConnectionKind,
	{ tailscale, lanAddress }: RemoteConnectionInputs
): RemoteConnectionChoice {
	const tailnet = tailscale.installed ? tailscale : undefined;
	if ( kind === 'https' ) {
		// `tailscale serve` takes HTTPS on the machine's name and forwards it here.
		return {
			ok: true,
			kind,
			host: '127.0.0.1',
			url: ( port ) => `https://${ tailnet?.dnsName }:${ port }`,
		};
	}
	const host = ( kind === 'tailnet' ? tailnet?.ipv4 : lanAddress ) as string;
	return { ok: true, kind, host, url: ( port ) => `http://${ urlHost( host ) }:${ port }` };
}

// The connection to run for `request`. Asked for by name, a connection that
// is not ready is refused with what it misses; Automatic falls back to the
// next one, and reports the local network's need if none is ready.
export function pickRemoteConnection(
	request: RemoteConnectionRequest,
	inputs: RemoteConnectionInputs
): RemoteConnectionChoice {
	const kinds = request === 'auto' ? REMOTE_CONNECTION_KINDS : [ request ];
	for ( const kind of kinds ) {
		if ( ! missingForConnection( kind, inputs ) ) {
			return readyChoice( kind, inputs );
		}
	}
	const last = kinds[ kinds.length - 1 ];
	return { ok: false, kind: last, missing: missingForConnection( last, inputs ) ?? 'network' };
}

export interface RemoteConnectionOption {
	kind: RemoteConnectionKind;
	missing?: RemoteConnectionMissing;
}

// Each connection with what it still needs, and the one Automatic takes now.
export function remoteConnectionOptions( inputs: RemoteConnectionInputs ): {
	automatic?: RemoteConnectionKind;
	options: RemoteConnectionOption[];
} {
	const choice = pickRemoteConnection( 'auto', inputs );
	return {
		automatic: choice.ok ? choice.kind : undefined,
		options: REMOTE_CONNECTION_KINDS.map( ( kind ) => ( {
			kind,
			missing: missingForConnection( kind, inputs ),
		} ) ),
	};
}

export function remoteConnectionName( kind: RemoteConnectionKind ): string {
	switch ( kind ) {
		case 'https':
			return __( 'Tailscale HTTPS' );
		case 'tailnet':
			return __( 'Tailnet' );
		case 'local':
			return __( 'Local network' );
	}
}

export function describeMissingConnection( missing: RemoteConnectionMissing ): string {
	switch ( missing ) {
		case 'tailscale':
			return __( 'Tailscale is not installed on this computer.' );
		case 'tailscale-sign-in':
			return __( 'Tailscale is not running, or not signed in.' );
		case 'tailscale-https':
			return __( 'HTTPS is not turned on for your tailnet in Tailscale.' );
		case 'network':
			return __( 'No network address found.' );
	}
}
