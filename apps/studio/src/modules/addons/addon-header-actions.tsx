/**
 * <AddonHeaderActions /> — Renders all addon-registered header action components.
 * Rendered inside Header, after the built-in site action buttons.
 */
import { Fragment } from 'react';
import { getEnabledAddons } from 'src/modules/addons/registry';

interface AddonHeaderActionsProps {
	selectedSite: SiteDetails | null;
}

export function AddonHeaderActions( { selectedSite }: AddonHeaderActionsProps ) {
	if ( ! selectedSite ) {
		return null;
	}

	const actions = getEnabledAddons().flatMap( ( addon ) => addon.headerActions ?? [] );

	if ( actions.length === 0 ) {
		return null;
	}

	return (
		<>
			{ actions.map( ( action ) => (
				<Fragment key={ action.id }>
					<action.component selectedSite={ selectedSite } />
				</Fragment>
			) ) }
		</>
	);
}
