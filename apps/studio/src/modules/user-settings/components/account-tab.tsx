import { useCallback } from 'react';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { authSelectors, authThunks } from 'src/stores/auth-slice';
import { NonAuthenticatedAccountTab } from './non-authenticated-account-tab';
import { PromptInfo } from './prompt-info';
import { SnapshotInfo } from './snapshot-info';
import { UserInfo } from './user-info';

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
	const dispatch = useAppDispatch();
	const isAuthenticated = useRootSelector( authSelectors.selectIsAuthenticated );
	const user = useRootSelector( authSelectors.selectUser );
	const logout = useCallback( () => dispatch( authThunks.authLogout() ), [ dispatch ] );

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
				</>
			) : (
				<NonAuthenticatedAccountTab />
			) }
		</>
	);
};
