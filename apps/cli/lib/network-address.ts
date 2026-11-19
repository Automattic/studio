import os from 'os';

// 169.254.0.0/16: assigned when DHCP fails, and no phone can reach it.
function isLinkLocal( address: string ): boolean {
	return address.startsWith( '169.254.' );
}

// The address `studio remote` binds and advertises unless `--host` names one.
export function getDefaultLanAddress(
	interfaces: NodeJS.Dict< os.NetworkInterfaceInfo[] > = os.networkInterfaces()
): string | undefined {
	for ( const addresses of Object.values( interfaces ) ) {
		for ( const candidate of addresses ?? [] ) {
			if (
				candidate.family === 'IPv4' &&
				! candidate.internal &&
				! isLinkLocal( candidate.address )
			) {
				return candidate.address;
			}
		}
	}
	return undefined;
}
