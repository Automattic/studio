import { describe, expect, it } from 'vitest';
import {
	describeMissingConnection,
	isRemoteConnectionRequest,
	missingForConnection,
	pickRemoteConnection,
	remoteConnectionOptions,
	type RemoteConnectionInputs,
} from '../remote-connection';

const LAN = '192.168.1.20';
const READY: RemoteConnectionInputs = {
	lanAddress: LAN,
	tailscale: {
		installed: true,
		running: true,
		ipv4: '100.101.102.103',
		dnsName: 'my-mac.tail1234.ts.net',
		httpsReady: true,
	},
};
const NO_HTTPS: RemoteConnectionInputs = {
	...READY,
	tailscale: { ...READY.tailscale, httpsReady: false } as RemoteConnectionInputs[ 'tailscale' ],
};
const SIGNED_OUT: RemoteConnectionInputs = {
	lanAddress: LAN,
	tailscale: { installed: true, running: false, httpsReady: false },
};
const NO_TAILSCALE: RemoteConnectionInputs = { lanAddress: LAN, tailscale: { installed: false } };

function picked( choice: ReturnType< typeof pickRemoteConnection > ) {
	return choice.ok
		? { kind: choice.kind, host: choice.host, url: choice.url( 8084 ) }
		: { kind: choice.kind, missing: choice.missing };
}

describe( 'pickRemoteConnection', () => {
	it( 'Automatic takes Tailscale HTTPS when it is ready', () => {
		expect( picked( pickRemoteConnection( 'auto', READY ) ) ).toEqual( {
			kind: 'https',
			host: '127.0.0.1',
			url: 'https://my-mac.tail1234.ts.net:8084',
		} );
	} );

	it( 'Automatic takes the tailnet when HTTPS is not turned on', () => {
		expect( picked( pickRemoteConnection( 'auto', NO_HTTPS ) ) ).toEqual( {
			kind: 'tailnet',
			host: '100.101.102.103',
			url: 'http://100.101.102.103:8084',
		} );
	} );

	it( 'Automatic takes the local network when Tailscale is signed out or missing', () => {
		for ( const inputs of [ SIGNED_OUT, NO_TAILSCALE ] ) {
			expect( picked( pickRemoteConnection( 'auto', inputs ) ) ).toEqual( {
				kind: 'local',
				host: LAN,
				url: 'http://192.168.1.20:8084',
			} );
		}
	} );

	it( 'Automatic reports the missing network when nothing is ready', () => {
		expect(
			picked( pickRemoteConnection( 'auto', { ...NO_TAILSCALE, lanAddress: undefined } ) )
		).toEqual( { kind: 'local', missing: 'network' } );
	} );

	it( 'refuses a connection asked for by name that is not ready, with what it misses', () => {
		expect( picked( pickRemoteConnection( 'https', NO_HTTPS ) ) ).toEqual( {
			kind: 'https',
			missing: 'tailscale-https',
		} );
		expect( picked( pickRemoteConnection( 'tailnet', SIGNED_OUT ) ) ).toEqual( {
			kind: 'tailnet',
			missing: 'tailscale-sign-in',
		} );
		expect( picked( pickRemoteConnection( 'https', NO_TAILSCALE ) ) ).toEqual( {
			kind: 'https',
			missing: 'tailscale',
		} );
	} );

	it( 'takes the local network by name even when Tailscale HTTPS is ready', () => {
		expect( picked( pickRemoteConnection( 'local', READY ) ) ).toMatchObject( {
			kind: 'local',
			host: LAN,
		} );
	} );

	it( 'puts an IPv6 local address in brackets', () => {
		expect(
			picked( pickRemoteConnection( 'local', { ...NO_TAILSCALE, lanAddress: 'fd00::20' } ) )
		).toMatchObject( { url: 'http://[fd00::20]:8084' } );
	} );
} );

describe( 'missingForConnection', () => {
	it( 'needs a tailnet address for the tailnet even when Tailscale runs', () => {
		const running = { installed: true as const, running: true, httpsReady: false };
		expect( missingForConnection( 'tailnet', { lanAddress: LAN, tailscale: running } ) ).toBe(
			'tailscale-sign-in'
		);
	} );
} );

describe( 'isRemoteConnectionRequest', () => {
	it( 'accepts the four requests only', () => {
		expect( [ 'auto', 'https', 'tailnet', 'local' ].every( isRemoteConnectionRequest ) ).toBe(
			true
		);
		expect( isRemoteConnectionRequest( 'funnel' ) ).toBe( false );
	} );
} );

describe( 'describeMissingConnection', () => {
	it( 'says what is missing in plain words', () => {
		expect( describeMissingConnection( 'tailscale-https' ) ).toBe(
			'HTTPS is not turned on for your tailnet in Tailscale.'
		);
	} );
} );

describe( 'remoteConnectionOptions', () => {
	it( 'lists each connection with what it needs, and what Automatic takes', () => {
		expect( remoteConnectionOptions( NO_HTTPS ) ).toEqual( {
			automatic: 'tailnet',
			options: [
				{ kind: 'https', missing: 'tailscale-https' },
				{ kind: 'tailnet', missing: undefined },
				{ kind: 'local', missing: undefined },
			],
		} );
	} );

	it( 'has nothing for Automatic when no connection is ready', () => {
		expect(
			remoteConnectionOptions( { ...NO_TAILSCALE, lanAddress: undefined } ).automatic
		).toBeUndefined();
	} );
} );
