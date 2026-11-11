import type { HostSite, StudioAgentHost } from './host';

export interface AdminMenuItem {
	screen: string;
	label: string;
	children: { screen: string; label: string }[];
}

export interface AdminInventory {
	menu: AdminMenuItem[];
	dashboardWidgets: { id: string; title: string }[];
}

/**
 * What an administrator really sees in wp-admin, plugins included. Only a real
 * page load has this: WP-CLI never builds the admin menu.
 */
export async function readAdminInventory(
	host: StudioAgentHost,
	site: HostSite
): Promise< AdminInventory > {
	// `curate-admin-full` shows the uncurated admin to an administrator, so a
	// second run still sees everything on the site.
	const page = await host.pages.open( {
		url: `${ site.url }/wp-admin/?curate-admin-full=1`,
		signIn: true,
	} );
	try {
		return await page.evaluate( ( adminUrl ) => {
			const screenOf = ( link: Element | null ) =>
				( ( link as HTMLAnchorElement | null )?.href ?? '' ).replace( adminUrl, '' );
			// Counts like "Comments 3" and "Plugins 0" sit in their own elements.
			const labelOf = ( link: Element | null ) => {
				const copy = link?.querySelector( '.wp-menu-name' )?.cloneNode( true ) as
					| Element
					| undefined;
				const element = copy ?? ( link?.cloneNode( true ) as Element | undefined );
				element
					?.querySelectorAll( '.update-plugins, .awaiting-mod, .menu-counter' )
					.forEach( ( count ) => count.remove() );
				return element?.textContent?.trim() ?? '';
			};

			return {
				menu: Array.from( document.querySelectorAll( '#adminmenu > li.menu-top' ) )
					.filter( ( item ) => item.id !== 'collapse-menu' )
					.map( ( item ) => {
						const top = item.querySelector( ':scope > a' );
						return {
							screen: screenOf( top ),
							label: labelOf( top ),
							children: Array.from(
								item.querySelectorAll( '.wp-submenu li:not(.wp-submenu-head) a' )
							).map( ( link ) => ( { screen: screenOf( link ), label: labelOf( link ) } ) ),
						};
					} ),
				dashboardWidgets: Array.from(
					document.querySelectorAll( '#dashboard-widgets .postbox' )
				).map( ( box ) => ( {
					id: box.id,
					title: box.querySelector( '.hndle' )?.textContent?.trim() ?? '',
				} ) ),
			};
		}, `${ site.url }/wp-admin/` );
	} finally {
		await page.close();
	}
}
