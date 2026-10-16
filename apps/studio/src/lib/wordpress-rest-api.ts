import {
	createJsonResponse,
	fetchSiteRest as fetchSiteRestShared,
} from '@studio/common/lib/wordpress-rest';
import { getSite } from 'src/lib/sites';
import type { SiteRestRequest, SiteRestResponse } from '@studio/common/types/wordpress-rest';
import type { IpcMainInvokeEvent } from 'electron';

export async function fetchSiteRest(
	_event: IpcMainInvokeEvent,
	siteId: string,
	request: SiteRestRequest
): Promise< SiteRestResponse > {
	const site = await getSite( siteId );
	if ( ! site ) {
		return createJsonResponse( 404, 'studio_site_not_found', `Site ${ siteId } not found.` );
	}

	const baseUrl =
		site.port > 0 ? `http://localhost:${ site.port }` : site.url.replace( /\/+$/, '' );

	return fetchSiteRestShared( { siteId, running: site.running, baseUrl }, request );
}
