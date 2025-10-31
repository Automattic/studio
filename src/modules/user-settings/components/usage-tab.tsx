import { PromptInfo } from './prompt-info';
import { SnapshotInfo } from './snapshot-info';

export const UsageTab = ( {
	loadingDeletingAllSnapshots,
	activeSnapshotCount,
	isLoadingSnapshotUsage,
	isOffline,
	snapshotQuota,
	onRemoveSnapshots,
}: {
	loadingDeletingAllSnapshots: boolean;
	activeSnapshotCount: number;
	isLoadingSnapshotUsage: boolean;
	isOffline: boolean;
	snapshotQuota: number;
	onRemoveSnapshots: () => void;
} ) => (
	<>
		<SnapshotInfo
			isDeleting={ loadingDeletingAllSnapshots || isLoadingSnapshotUsage }
			isDisabled={
				activeSnapshotCount === 0 ||
				isOffline ||
				loadingDeletingAllSnapshots ||
				isLoadingSnapshotUsage
			}
			siteCount={ activeSnapshotCount }
			siteLimit={ snapshotQuota }
			onRemoveSnapshots={ onRemoveSnapshots }
		/>
		<PromptInfo />
	</>
);
