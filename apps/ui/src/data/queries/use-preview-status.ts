import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { getSnapshotHostname } from '@/data/snapshot-url';
import type { Snapshot } from '@/data/core';

export const previewStatusQueryKey = ( snapshot: Snapshot | undefined ) => [
	'preview-status',
	snapshot?.userId,
	snapshot?.localSiteId,
	snapshot?.url,
	snapshot?.versionId,
	snapshot?.syncedAt,
	snapshot?.date,
];

export function usePreviewStatus( snapshot: Snapshot | undefined, enabled: boolean ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: previewStatusQueryKey( snapshot ),
		queryFn: () => connector.getPreviewStatus( getSnapshotHostname( snapshot! ) ),
		enabled: !! snapshot && enabled,
		refetchInterval: 30_000,
		refetchOnWindowFocus: 'always',
		meta: { persist: false },
	} );
}
