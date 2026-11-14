import type { RemoteSiteConnection } from '@/data/core';
import type { SitesProviderId } from '@studio/providers';

export function isNewDestination( remote: RemoteSiteConnection< SitesProviderId > | undefined ) {
	return (
		!! remote &&
		! remote.lastPushTimestamp &&
		'launchAfterPush' in remote &&
		remote.launchAfterPush === true &&
		remote.launchStatus === 'unlaunched'
	);
}
