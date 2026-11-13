import { getRemoteSites } from '@studio/common/lib/remote-sites';
import { getCurrentUserId } from '@studio/common/lib/shared-config';
import { getProviderSites, type SitesProviderId } from '@studio/providers';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getSnapshotsFromConfig } from 'cli/lib/cli-config/snapshots';
import { getSiteVersion } from 'cli/lib/site-versions';

export async function runCommand(
	siteFolder: string,
	remoteSiteId: number | string,
	provider: SitesProviderId = 'wpcom'
) {
	const site = await getSiteByFolder( siteFolder );
	const connection = ( await getRemoteSites( provider, site.id ) ).find(
		( item ) => String( item.id ) === String( remoteSiteId )
	);
	if ( ! connection ) throw new Error( 'Connected site not found' );
	let version = connection.localVersionId;
	// An upgraded preview is still the same remote site. Only use its baseline if
	// no later transfer has replaced it; null explicitly invalidates partial transfers.
	if ( version === undefined && getProviderSites( provider ).previews ) {
		const userId = await getCurrentUserId();
		const snapshot = userId
			? ( await getSnapshotsFromConfig( userId ) ).find(
					( item ) =>
						String( item.atomicSiteId ) === String( remoteSiteId ) && item.localSiteId === site.id
			  )
			: undefined;
		const timestamps = [ connection.lastPushTimestamp, connection.lastPullTimestamp ].filter(
			( value ): value is string => !! value
		);
		if (
			snapshot?.versionId &&
			snapshot.syncedAt &&
			timestamps.every( ( timestamp ) => Date.parse( timestamp ) <= snapshot.syncedAt! )
		)
			version = snapshot.versionId;
	}
	return {
		localChanged: version ? ( await getSiteVersion( site.id, site.path ) ) !== version : null,
	};
}
