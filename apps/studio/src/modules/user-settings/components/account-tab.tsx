import { useAuth } from 'src/hooks/use-auth';
import { NonAuthenticatedAccountTab } from './non-authenticated-account-tab';
import { PromptInfo } from './prompt-info';
import { SnapshotInfo } from './snapshot-info';
import { UserInfo } from './user-info';
import { WapuuScore } from './wapuu-score';

export const AccountTab = ( {
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
					<UserInfo onLogout={ logout } user={ user } />
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
					<WapuuScore />
				</>
			) : (
				<NonAuthenticatedAccountTab />
			) }
		</>
	);
};
