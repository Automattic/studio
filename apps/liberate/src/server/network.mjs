// Public-address checks shared by the server's URL validation and the egress
// guard. The pipeline preloads this file into the data-liberation and Studio
// CLI processes (NODE_OPTIONS=--import) with LIBERATE_EGRESS_GUARD=1, so a
// crawled site can't point any request at an internal address through a
// hostname, whichever code path makes it. Plain JavaScript on purpose: it must
// load in every Node process the pipeline spawns.
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
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

/**
 * Wrap a callback-style `dns.lookup` so that, except for `localhost` (the
 * Studio sites the pipeline itself talks to), hostnames resolving to
 * non-public addresses fail as if they did not exist.
 *
 * @param {typeof dns.lookup} lookup
 * @returns {typeof dns.lookup}
 */
function guardLookup( lookup ) {
	// @ts-expect-error -- the overloads of dns.lookup can't be expressed on a plain function.
	return function guardedLookup( hostname, options, callback ) {
		if ( typeof options === 'function' ) {
			callback = options;
			options = {};
		}
		if ( hostname === 'localhost' || isIP( hostname ) ) {
			return lookup( hostname, options, callback );
		}
		return lookup( hostname, options, ( error, address, family ) => {
			const addresses = Array.isArray( address ) ? address.map( ( a ) => a.address ) : [ address ];
			if ( ! error && ! addresses.every( ( a ) => isPublicAddress( a ) ) ) {
				error = Object.assign( new Error( `getaddrinfo ENOTFOUND ${ hostname }` ), {
					code: 'ENOTFOUND',
					hostname,
				} );
			}
			callback( error, address, family );
		} );
	};
}

if ( process.env.LIBERATE_EGRESS_GUARD === '1' ) {
	const guarded = guardLookup( dns.lookup );
	dns.lookup = guarded;
	dns.promises.lookup = ( hostname, options = {} ) =>
		new Promise( ( resolve, reject ) =>
			guarded( hostname, options, ( error, address, family ) =>
				error
					? reject( error )
					: resolve( Array.isArray( address ) ? address : { address, family } )
			)
		);
	syncBuiltinESMExports();
}
