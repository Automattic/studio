import { useAuth } from 'src/hooks/use-auth';
import { AccountTab } from './account-tab';
import { NonAuthenticatedAccountTab } from './non-authenticated-account-tab';
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
} ) => {
	const { isAuthenticated, user, logout } = useAuth();

	return (
		<>
			{ isAuthenticated ? (
				<>
					<AccountTab user={ user } logout={ logout } />
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
			) : (
				<NonAuthenticatedAccountTab />
			) }
		</>
	);
};
