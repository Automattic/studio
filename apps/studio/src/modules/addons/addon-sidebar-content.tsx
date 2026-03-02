/**
 * <AddonSidebarContent /> — Renders all addon-registered sidebar content components.
 * Rendered inside the scrollable sites container in MainSidebar, after <SiteMenu />.
 */
import { Fragment } from 'react';
import { getEnabledAddons } from 'src/modules/addons/registry';

export function AddonSidebarContent() {
	const addons = getEnabledAddons().filter( ( addon ) => addon.sidebarContent != null );

	if ( addons.length === 0 ) {
		return null;
	}

	return (
		<>
			{ addons.map( ( addon ) => {
				const SidebarComponent = addon.sidebarContent!;
				return (
					<Fragment key={ addon.manifest.id }>
						<SidebarComponent />
					</Fragment>
				);
			} ) }
		</>
	);
}
