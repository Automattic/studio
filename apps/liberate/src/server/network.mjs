// Public-address checks for the server's URL validation: a visitor's address must be a
// public one, checked after DNS resolution.
import { BlockList, isIP } from 'node:net';

const nonPublic = new BlockList();
for ( const [ net, prefix ] of [
	[ '0.0.0.0', 8 ],
	[ '10.0.0.0', 8 ],
	[ '100.64.0.0', 10 ],
	[ '127.0.0.0', 8 ],
	[ '169.254.0.0', 16 ],
	[ '172.16.0.0', 12 ],
	[ '192.0.0.0', 24 ],
	[ '192.0.2.0', 24 ],
	[ '192.88.99.0', 24 ],
	[ '192.168.0.0', 16 ],
	[ '198.18.0.0', 15 ],
	[ '198.51.100.0', 24 ],
	[ '203.0.113.0', 24 ],
	[ '224.0.0.0', 3 ],
] ) {
	nonPublic.addSubnet( net, prefix, 'ipv4' );
}
for ( const [ net, prefix ] of [
	[ '::', 127 ],
	[ '64:ff9b::', 96 ],
	[ '64:ff9b:1::', 48 ],
	[ '100::', 64 ],
	[ '2001::', 23 ],
	[ '2001:db8::', 32 ],
	[ '2002::', 16 ],
	[ 'fc00::', 7 ],
	[ 'fe80::', 10 ],
	[ 'fec0::', 10 ],
	[ 'ff00::', 8 ],
] ) {
	nonPublic.addSubnet( net, prefix, 'ipv6' );
}

/**
 * True for globally routable unicast addresses. IPv4-mapped IPv6 addresses are
 * checked against the IPv4 rules.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isPublicAddress( address ) {
	const family = isIP( address );
	return family !== 0 && ! nonPublic.check( address, family === 6 ? 'ipv6' : 'ipv4' );
}
