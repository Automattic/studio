import { describe, expect, it } from 'vitest';
import { getDefaultLanAddress } from 'cli/lib/network-address';
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
} );
