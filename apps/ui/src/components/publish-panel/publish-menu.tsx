import { __ } from '@wordpress/i18n';
import * as Menu from '@/components/menu';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { WebsiteMenuItems } from './connected-view';
import { websiteAddress } from './options';
import { useOpenPublish, type PublishRequest } from './request';
import type { SiteDetails } from '@/data/core';

// The site menu's Publish entry: a submenu per connected website, or a plain
// item that opens the panel to set one up.
export function SitePublishMenu( { site, disabled }: { site: SiteDetails; disabled: boolean } ) {
	const openPublish = useOpenPublish();
	const user = useAuthUser();
	const connected = useConnectedWpcomSites( site.id );
	const websites = user.data ? connected.data ?? [] : [];
	const open = ( view: PublishRequest[ 'view' ], remoteSiteId?: number ) =>
		openPublish( { siteId: site.id, view, remoteSiteId } );
	if ( ! websites.length ) {
		return (
			<Menu.Item disabled={ disabled } onClick={ () => open( 'publish' ) }>
				{ __( 'Publish' ) }
			</Menu.Item>
		);
	}
	return (
		<Menu.SubmenuRoot>
			<Menu.SubmenuTrigger disabled={ disabled }>{ __( 'Publish' ) }</Menu.SubmenuTrigger>
			<Menu.Popup side="right" align="start">
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
							<Menu.Popup side="right" align="start">
								<WebsiteMenuItems
									remote={ remote }
									disabled={ disabled }
									includePublish
									onOpen={ ( view ) => open( view, remote.id ) }
								/>
							</Menu.Popup>
						</Menu.SubmenuRoot>
					) )
				) }
			</Menu.Popup>
		</Menu.SubmenuRoot>
	);
}
