import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useNavigate, useParams } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronRightSmall, Icon } from '@wordpress/icons';
import { useState } from 'react';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import * as Menu from '@/components/menu';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { QuickMenuItem } from '@/components/site-quick-menu';
import { useConnector } from '@/data/core';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useCustomizeLinks } from '@/hooks/use-customize-links';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
import { useSiteManagementActions } from '@/hooks/use-site-management-actions';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { CustomizeLink } from '@/hooks/use-customize-links';
import type { ReactElement } from 'react';

function SubmenuLabel( { label }: { label: string } ) {
	return (
		<>
			<span>{ label }</span>
			<Icon
				icon={ chevronRightSmall }
				size={ 16 }
				className={ styles.submenuChevron }
				aria-hidden="true"
			/>
		</>
	);
}

/**
 * Right-click quick actions for a sidebar site/plugin row. The row element
 * itself is passed as `trigger` and rendered via the context-menu trigger's
 * render prop, so no wrapper DOM is added around it (the sidebar's
 * drag-reorder CSS and animation code rely on the row's DOM position).
 */
export function SiteContextMenu( { site, trigger }: { site: SiteDetails; trigger: ReactElement } ) {
	const navigate = useNavigate();
	const connector = useConnector();
	const params = useParams( { strict: false } ) as { siteId?: string };
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const openSiteUrl = useOpenSiteUrl( site );
	const { customizeLinks, contentLinks, adminLink } = useCustomizeLinks( site );
	// No `onOpen`: last-used tracking belongs to the split-button menus.
	const destinations = useOpenInDestinations( site, undefined, '/' );
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const managementActions = useSiteManagementActions( site, {
		onDelete: () => setDeleteOpen( true ),
	} );

	const busy = isStarting || isStopping;

	const linkItem = ( link: CustomizeLink ) => (
		<QuickMenuItem
			key={ link.id }
			icon={ link.icon }
			label={ link.label }
			disabled={ busy }
			onClick={ () => {
				if ( link.id === 'wp-admin' ) {
					void connector.trackEvent( TRACKS_EVENTS.SITE_OPEN_WP_ADMIN, {
						browser: 'internal',
					} );
				}
				void openSiteUrl( link.url );
			} }
		/>
	);

	return (
		<>
			<Menu.ContextMenuRoot>
				<Menu.ContextMenuTrigger render={ trigger } />
				<Menu.ContextPopup className={ styles.popup }>
					<Menu.Item
						disabled={ busy }
						onClick={ () =>
							site.running ? stopSite.mutate( site.id ) : startSite.mutate( site.id )
						}
					>
						{ site.running ? __( 'Stop site' ) : __( 'Start site' ) }
					</Menu.Item>
					<Menu.Separator />
					<Menu.Item
						onClick={ () => {
							void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: 'settings' } );
							void navigate( {
								to: '/sites/$siteId/overview',
								params: { siteId: site.id },
								search: { tab: 'settings' },
							} );
						} }
					>
						{ __( 'Site settings' ) }
					</Menu.Item>
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger>
							<SubmenuLabel label={ __( 'Open WordPress' ) } />
						</Menu.SubmenuTrigger>
						<Menu.Popup side="right" align="start">
							{ customizeLinks.map( linkItem ) }
							<Menu.Separator />
							{ contentLinks.map( linkItem ) }
							<Menu.Separator />
							{ linkItem( adminLink ) }
						</Menu.Popup>
					</Menu.SubmenuRoot>
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger>
							<SubmenuLabel label={ __( 'Open in' ) } />
						</Menu.SubmenuTrigger>
						<Menu.Popup side="right" align="start">
							{ destinations.map( ( destination ) => (
								<QuickMenuItem
									key={ destination.id }
									icon={ destination.logo }
									label={ destination.label }
									disabled={ destination.disabled }
									onClick={ destination.open }
								/>
							) ) }
						</Menu.Popup>
					</Menu.SubmenuRoot>
					<Menu.Separator />
					{ managementActions
						.filter( ( action ) => ! action.destructive )
						.map( ( action ) => (
							<Menu.Item key={ action.id } disabled={ action.disabled } onClick={ action.run }>
								{ action.label }
							</Menu.Item>
						) ) }
					<Menu.Separator />
					{ managementActions
						.filter( ( action ) => action.destructive )
						.map( ( action ) => (
							<Menu.Item
								key={ action.id }
								className={ styles.destructiveItem }
								disabled={ action.disabled }
								onClick={ action.run }
							>
								{ action.label }
							</Menu.Item>
						) ) }
				</Menu.ContextPopup>
			</Menu.ContextMenuRoot>
			<DeleteSiteDialog
				site={ site }
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onDeleted={ () => {
					// Only leave the current view when it belongs to the deleted
					// site — deleting another row shouldn't navigate away.
					if ( params.siteId === site.id ) {
						void navigate( { to: '/' } );
					}
				} }
			/>
		</>
	);
}
