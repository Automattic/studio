import { Snapshot } from 'common/types/snapshot';
import { PromptInfo } from './prompt-info';
import { SnapshotInfo } from './snapshot-info';

export const UsageTab = ( {
	loadingDeletingAllSnapshots,
	activeSnapshotCount,
	isLoadingAllSnapshots,
	isLoadingSnapshotUsage,
	allSnapshots,
	isOffline,
	snapshotQuota,
	onRemoveSnapshots,
}: {
	loadingDeletingAllSnapshots: boolean;
	activeSnapshotCount: number;
	isLoadingAllSnapshots: boolean;
	isLoadingSnapshotUsage: boolean;
	allSnapshots: Pick< Snapshot, 'atomicSiteId' >[] | null;
	isOffline: boolean;
	snapshotQuota: number;
	onRemoveSnapshots: () => void;
} ) => (
	<>
		<SnapshotInfo
			isDeleting={ loadingDeletingAllSnapshots }
			isDisabled={
				activeSnapshotCount === 0 ||
				loadingDeletingAllSnapshots ||
				isLoadingAllSnapshots ||
				isLoadingSnapshotUsage ||
				allSnapshots?.length === 0 ||
				isOffline
			}
			siteCount={ activeSnapshotCount }
			siteLimit={ snapshotQuota }
			onRemoveSnapshots={ onRemoveSnapshots }
		/>
		<PromptInfo />
	</>
);
