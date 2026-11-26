import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { getRemoteSites } from '@studio/common/lib/remote-sites';
import { __ } from '@wordpress/i18n';
import { findSiteById, getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getSiteVersion } from 'cli/lib/site-versions';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';
import { wpcomSites } from 'cli/lib/sync-api';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { LoggerError } from 'cli/logger';
import type { PreviewStatus } from '@studio/common/sites/snapshots';
import type { SitesProviderId } from '@studio/providers';

async function localChanges(
	site: { id: string; path: string } | undefined,
	version?: string | null
) {
	if ( ! site || ! version ) return null;
	try {
		return ( await getSiteVersion( site.id, site.path ) ) !== version;
	} catch {
		return null;
	}
}

export async function getDestinationStatus(
	target:
		| { host: string }
		| { siteFolder: string; remoteSiteId: number | string; provider: SitesProviderId }
): Promise< PreviewStatus > {
	if ( 'host' in target ) {
		const token = await requireAuthToken();
		const hostname = normalizeHostname( target.host );
		const preview = ( await getSnapshotsFromConfig( token.id ) ).find(
			( item ) => normalizeHostname( item.url ) === hostname
		);
		if ( ! preview )
			throw new LoggerError( __( 'Preview site not found' ), undefined, 'not_found' );
		const site = preview.localSiteId ? await findSiteById( preview.localSiteId ) : undefined;
		const { syncedAt } = preview;
		const [ localChanged, previewChanged ] = await Promise.all( [
			localChanges( site, preview.versionId ),
			syncedAt !== undefined
				? wpcomSites.editedAt!( { token: token.accessToken }, { id: preview.atomicSiteId } )
						.then( ( edited ) => edited > syncedAt )
						.catch( () => null )
				: null,
		] );
		return { localSiteId: site?.id ?? null, localChanged, previewChanged };
	}
	const site = await getSiteByFolder( target.siteFolder );
	const connection = ( await getRemoteSites( target.provider, site.id ) ).find(
		( item ) => String( item.id ) === String( target.remoteSiteId )
	);
	if ( ! connection ) throw new Error( 'Connected site not found' );
	return {
		localSiteId: site.id,
		localChanged: await localChanges( site, connection.localVersionId ),
		previewChanged: null,
	};
}
