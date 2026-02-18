import { MenuItem } from '@wordpress/components';
import { useSiteDetails } from 'src/hooks/use-site-details';
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
	const isPulling = useRootSelector(
		syncOperationsSelectors.selectIsSiteIdPulling( selectedSite?.id ?? '' )
	);
	const isPushing = useRootSelector(
		syncOperationsSelectors.selectIsSiteIdPushing( selectedSite?.id ?? '' )
	);
	if ( ! selectedSite ) {
		return null;
	}
	const isThisSiteSyncing = isPulling || isPushing;
	const isAddingSite = sites.some( ( site ) => site.isAddingSite );
	const isDisabled = isDeleting || isThisSiteSyncing || isAddingSite;

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
