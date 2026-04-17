import { MenuItem } from '@wordpress/components';
import { useSiteDetails } from 'src/hooks/use-site-details';
import {
	pullBackupIsDownloadingOrImporting,
	pushBackupIsUploading,
} from 'src/lib/active-sync-operations';
import { useRootSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync';

type SettingsMenuItemProps = {
	onClick: () => void;
	children: React.ReactNode;
	isDestructive?: boolean;
};

export const SettingsMenuItem = ( {
	onClick,
	children,
	isDestructive = false,
}: SettingsMenuItemProps ) => {
	const { isDeleting, sites, selectedSite } = useSiteDetails();
	const selectedSiteId = selectedSite?.id;
	const isThisSiteDoingLocalSyncWork = useRootSelector( ( state ) => {
		if ( ! selectedSiteId ) {
			return false;
		}
		const pullStates = syncOperationsSelectors.selectPullStates( state );
		const pushStates = syncOperationsSelectors.selectPushStates( state );
		const anyPullLocal = Object.values( pullStates ).some(
			( pullState ) =>
				pullState.selectedSite?.id === selectedSiteId &&
				pullBackupIsDownloadingOrImporting( pullState.status.key )
		);
		const anyPushLocal = Object.values( pushStates ).some(
			( pushState ) =>
				pushState.selectedSite?.id === selectedSiteId &&
				pushBackupIsUploading( pushState.status.key )
		);
		return anyPullLocal || anyPushLocal;
	} );
	if ( ! selectedSite ) {
		return null;
	}
	const isAddingSite = sites.some( ( site ) => site.isAddingSite );
	const isDisabled = isDeleting || isThisSiteDoingLocalSyncWork || isAddingSite;

	return (
		<MenuItem
			className="flex"
			aria-disabled={ isDisabled }
			onClick={ () => {
				if ( isDisabled ) {
					return;
				}
				onClick();
			} }
			isDestructive={ isDestructive }
			disabled={ isDisabled }
		>
			{ children }
		</MenuItem>
	);
};
