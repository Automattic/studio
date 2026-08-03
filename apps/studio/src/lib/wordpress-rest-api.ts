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

	const publicUrl = server.server.url.replace( /\/+$/, '' );
	const baseUrl = server.details.port > 0 ? `http://localhost:${ server.details.port }` : publicUrl;

	return fetchSiteRestShared(
		{
			siteId,
			running: server.details.running,
			baseUrl,
			publicUrl,
		},
		request
	);
}
