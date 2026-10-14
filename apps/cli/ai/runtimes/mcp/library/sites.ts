import { readAuthToken } from '@studio/common/lib/shared-config';
import { fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import { captureScreenshotBuffer } from 'cli/ai/tools/screenshot-helpers';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { getSitesRunningStatus } from 'cli/lib/site-utils';

// Reads the config directly rather than through site_list, whose console
// capture loses output when the page's calls overlap.
export async function readLocalSites() {
	const { sites } = await readCliConfig();
	const running = await getSitesRunningStatus( sites );
	return sites.map( ( site ) => ( {
		id: site.id,
		name: site.name,
		path: site.path,
		url: getSiteUrl( site ),
		running: running.get( site.id ) ?? false,
		phpVersion: site.phpVersion,
	} ) );
}

// The WordPress.com sites the stored login can reach.
export async function readWpcomSites() {
	const token = await readAuthToken();
	if ( ! token?.accessToken ) {
		return { signedIn: false, sites: [] };
	}
	try {
		const sites = await fetchSyncableSites( token.accessToken );
		return {
			signedIn: true,
			sites: sites.map(
				( { id, name, url, planName, isStaging, lastPullTimestamp, lastPushTimestamp } ) => ( {
					id,
					name,
					url,
					planName,
					isStaging,
					lastPullTimestamp,
					lastPushTimestamp,
				} )
			),
		};
	} catch ( error ) {
		return {
			signedIn: true,
			sites: [],
			error: error instanceof Error ? error.message : String( error ),
		};
	}
}

// A small JPEG of a site's front page, as a data URL.
export async function capturePreview( url: string ) {
	const { buffer } = await captureScreenshotBuffer(
		url,
		{ width: 1280, height: 582 },
		{ fullPage: false, format: 'jpeg', deviceScaleFactor: 0.5 }
	);
	return `data:image/jpeg;base64,${ buffer.toString( 'base64' ) }`;
}
