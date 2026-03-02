/**
 * <AddonHeaderActions /> — Renders all addon-registered header action components.
 * Rendered inside Header, after the built-in site action buttons.
 */
import { Fragment } from 'react';
import { useEnabledAddons } from 'src/modules/addons/enabled-addons-context';

interface AddonHeaderActionsProps {
	selectedSite: SiteDetails | null;
}

export function AddonHeaderActions( { selectedSite }: AddonHeaderActionsProps ) {
	const actions = useEnabledAddons().flatMap( ( addon ) => addon.headerActions ?? [] );

	if ( ! selectedSite ) {
		return null;
	}

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
