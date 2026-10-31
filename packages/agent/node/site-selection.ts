import type { RemoteHost } from './remote-hosts';
import type { SiteInfo } from './types';

// The active site, as the system prompt states it: which site the session is
// attached to, rebuilt every turn from Studio's site data.
export function formatActiveSite(
	site: SiteInfo,
	remoteHosts: Record< string, RemoteHost > = {}
): string {
	if ( site.remote && site.url ) {
		const hostName = remoteHosts[ site.remote.host ]?.name ?? site.remote.host;
		return `"${ site.name }" (ID: ${ site.remote.id }) at ${ site.url } (${ hostName })`;
	}
	return `"${ site.name }" at ${ site.path }${ site.running ? ' (running)' : ' (stopped)' }`;
}
