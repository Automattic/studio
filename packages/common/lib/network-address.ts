import os from 'os';

// The private ranges of IPv4 (RFC 1918): a home or office network. Outside
// them an address can be public, and remote mode is not for the internet.
function isPrivateAddress( address: string ): boolean {
	const [ first, second ] = address.split( '.' ).map( Number );
	return (
		first === 10 ||
		( first === 172 && second >= 16 && second <= 31 ) ||
		( first === 192 && second === 168 )
	);
}

// 100.64.0.0/10: Tailscale's addresses (and carrier NAT's), never the local
// network's. Remote mode reaches them through its tailnet connection.
export function isTailnetAddress( address: string ): boolean {
	const [ first, second ] = address.split( '.' ).map( Number );
	return first === 100 && second >= 64 && second <= 127;
}

// The address remote mode's local network connection listens on and
// advertises, unless `--host` names one: the first private IPv4 address. That
// leaves out link-local (169.254.0.0/16, when DHCP fails) and Tailscale's
// addresses too.
export function getDefaultLanAddress(
	interfaces: NodeJS.Dict< os.NetworkInterfaceInfo[] > = os.networkInterfaces()
): string | undefined {
	for ( const addresses of Object.values( interfaces ) ) {
		for ( const candidate of addresses ?? [] ) {
			if (
				candidate.family === 'IPv4' &&
				! candidate.internal &&
				isPrivateAddress( candidate.address )
			) {
				return candidate.address;
			}
		}
	}
	return undefined;
}
