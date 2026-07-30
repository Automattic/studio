import {
	createJsonResponse,
	fetchSiteRest as fetchSiteRestShared,
} from '@studio/common/lib/wordpress-rest';
import { SiteServer } from 'src/site-server';
import type { SiteRestRequest, SiteRestResponse } from '@studio/common/types/wordpress-rest';
import type { IpcMainInvokeEvent } from 'electron';

export async function fetchSiteRest(
	_event: IpcMainInvokeEvent,
	siteId: string,
	request: SiteRestRequest
): Promise< SiteRestResponse > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		return createJsonResponse( 404, 'studio_site_not_found', `Site ${ siteId } not found.` );
	}

	// Dial `localhost`, not `127.0.0.1`: native-PHP site servers bind
	// `localhost`, which may resolve to IPv6 `::1` only — fetch negotiates
	// whichever address family actually listens.
	const baseUrl =
		server.details.port > 0
			? `http://localhost:${ server.details.port }`
			: server.server.url.replace( /\/+$/, '' );

	return fetchSiteRestShared(
		{
			siteId,
			running: server.details.running,
			baseUrl,
		},
		request
	);
}
