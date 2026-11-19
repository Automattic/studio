import { describe, expect, it } from 'vitest';
import { getDefaultLanAddress, isTailnetAddress } from '../network-address';
import type { NetworkInterfaceInfo } from 'os';

function address( overrides: Partial< NetworkInterfaceInfo > ): NetworkInterfaceInfo {
	return {
		address: '192.168.1.20',
		netmask: '255.255.255.0',
		family: 'IPv4',
		mac: '00:00:00:00:00:00',
		internal: false,
		cidr: null,
		...overrides,
	} as NetworkInterfaceInfo;
}

describe( 'getDefaultLanAddress', () => {
	it( 'picks the first IPv4 address that is not internal', () => {
		expect(
			getDefaultLanAddress( {
				lo0: [ address( { address: '127.0.0.1', internal: true } ) ],
				en0: [
					address( { address: 'fe80::1', family: 'IPv6' } ),
					address( { address: '192.168.1.20' } ),
				],
				utun4: [ address( { address: '100.64.0.7' } ) ],
			} )
		).toBe( '192.168.1.20' );
	} );

	it( 'returns undefined when the computer is offline', () => {
		expect(
			getDefaultLanAddress( { lo0: [ address( { address: '127.0.0.1', internal: true } ) ] } )
		).toBeUndefined();
	} );

	it( 'skips link-local addresses in favour of a later LAN address', () => {
		expect(
			getDefaultLanAddress( {
				en1: [ address( { address: '169.254.12.34' } ) ],
				en0: [ address( { address: '192.168.1.20' } ) ],
			} )
		).toBe( '192.168.1.20' );
	} );

	it( 'returns undefined when only link-local addresses are available', () => {
		expect(
			getDefaultLanAddress( { en1: [ address( { address: '169.254.12.34' } ) ] } )
		).toBeUndefined();
	} );

	it( 'skips a public address, which would put remote mode on the internet', () => {
		expect(
			getDefaultLanAddress( {
				eth0: [ address( { address: '203.0.113.7' } ) ],
				eth1: [ address( { address: '10.0.0.12' } ) ],
			} )
		).toBe( '10.0.0.12' );
		expect(
			getDefaultLanAddress( { eth0: [ address( { address: '172.32.0.1' } ) ] } )
		).toBeUndefined();
		expect( getDefaultLanAddress( { eth0: [ address( { address: '172.20.10.2' } ) ] } ) ).toBe(
			'172.20.10.2'
		);
	} );

	it( 'skips a Tailscale address listed before the local network one', () => {
		expect(
			getDefaultLanAddress( {
				utun4: [ address( { address: '100.101.102.103' } ) ],
				en0: [ address( { address: '192.168.1.20' } ) ],
			} )
		).toBe( '192.168.1.20' );
	} );
} );

describe( 'isTailnetAddress', () => {
	it( 'is true for 100.64.0.0/10 only', () => {
		expect( isTailnetAddress( '100.64.0.1' ) ).toBe( true );
		expect( isTailnetAddress( '100.127.255.254' ) ).toBe( true );
		expect( isTailnetAddress( '100.63.255.255' ) ).toBe( false );
		expect( isTailnetAddress( '100.128.0.1' ) ).toBe( false );
		expect( isTailnetAddress( '192.168.1.20' ) ).toBe( false );
	} );
} );
