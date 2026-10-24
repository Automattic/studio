import { __ } from '@wordpress/i18n';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { useOpenHeaderPanel } from '@/features/sites';
import { SyncIcon } from '@/lib/icons';
import { Menu } from '@/lib/ui';
import { WebsiteMenuItems } from './connected-view';
import { websiteAddress } from './options';
import type { SiteDetails } from '@/data/core';

// The site menu's Publish entry: a submenu per connected website, or a plain
// item that opens the panel to set one up.
export function SitePublishMenu( { site, disabled }: { site: SiteDetails; disabled: boolean } ) {
	const openHeaderPanel = useOpenHeaderPanel();
	const user = useAuthUser();
	const connected = useConnectedWpcomSites( site.id );
	const websites = user.data ? connected.data ?? [] : [];
	const open = ( view: 'publish' | 'pull' | 'websites', remoteSiteId?: number ) =>
		openHeaderPanel( { panel: 'publish', siteId: site.id, view, remoteSiteId } );
	if ( ! websites.length ) {
		return (
			<Menu.Item disabled={ disabled } onClick={ () => open( 'publish' ) }>
				<SyncIcon />
				{ __( 'Publish' ) }
			</Menu.Item>
		);
	}
	return (
		<Menu.SubmenuRoot>
			<Menu.SubmenuTrigger disabled={ disabled }>
				<SyncIcon />
				{ __( 'Publish' ) }
			</Menu.SubmenuTrigger>
			<Menu.SubmenuPopup>
				{ websites.length === 1 ? (
					<WebsiteMenuItems
						remote={ websites[ 0 ] }
						disabled={ disabled }
						includePublish
						onOpen={ ( view ) => open( view, websites[ 0 ].id ) }
					/>
				) : (
					websites.map( ( remote ) => (
						<Menu.SubmenuRoot key={ remote.id }>
							<Menu.SubmenuTrigger>{ websiteAddress( remote ) }</Menu.SubmenuTrigger>
							<Menu.SubmenuPopup>
								<WebsiteMenuItems
									remote={ remote }
									disabled={ disabled }
									includePublish
									onOpen={ ( view ) => open( view, remote.id ) }
								/>
							</Menu.SubmenuPopup>
						</Menu.SubmenuRoot>
					) )
				) }
			</Menu.SubmenuPopup>
		</Menu.SubmenuRoot>
	);
}
