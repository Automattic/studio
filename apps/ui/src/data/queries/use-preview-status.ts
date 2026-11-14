import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { getSnapshotHostname } from '@/data/snapshot-url';
import type { Connector, Snapshot } from '@/data/core';

const previewStatusQueryKey = ( snapshot: Snapshot | undefined ) => [
	'preview-status',
	snapshot?.userId,
	snapshot?.localSiteId,
	snapshot?.url,
	snapshot?.versionId,
	snapshot?.syncedAt,
	snapshot?.date,
];

export function previewStatusQuery( connector: Connector, snapshot: Snapshot | undefined ) {
	return {
		queryKey: previewStatusQueryKey( snapshot ),
		queryFn: () => connector.getPreviewStatus( getSnapshotHostname( snapshot! ) ),
		meta: { persist: false },
	};
}

export function usePreviewStatus( snapshot: Snapshot | undefined, enabled: boolean ) {
	const connector = useConnector();
	return useQuery( {
		...previewStatusQuery( connector, snapshot ),
		enabled: !! snapshot && enabled,
		refetchInterval: 30_000,
		refetchOnWindowFocus: 'always',
	} );
}
