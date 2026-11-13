import { useQuery } from '@tanstack/react-query';
import { useConnector, type SyncSite } from '@/data/core';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useAuthUser } from './use-auth-user';

export function useSitePublishStatus( siteId: string, remote: SyncSite | undefined ) {
	const connector = useConnector();
	const user = useAuthUser();
	const activity = useSiteSyncActivity( siteId );
	return useQuery( {
		queryKey: [
			'site-publish-status',
			siteId,
			user.data?.id,
			remote?.id,
			remote?.localVersionId,
			remote?.lastPushTimestamp,
			remote?.lastPullTimestamp,
			activity?.kind,
		],
		queryFn: () => connector.getSitePublishStatus( siteId, remote!.id ),
		enabled: !! user.data && !! remote && ! remote.isPressable && activity?.kind !== 'pending',
		refetchInterval: 30_000,
		refetchOnWindowFocus: 'always',
		meta: { persist: false },
	} );
}
