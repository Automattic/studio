import { useNavigate, useParams } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronRightSmall, Icon } from '@wordpress/icons';
import { useState } from 'react';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import * as Menu from '@/components/menu';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { QuickMenuItem } from '@/components/site-quick-menu';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useCustomizeLinks } from '@/hooks/use-customize-links';
import { useOpenSiteUrl } from '@/hooks/use-open-site-url';
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
	const params = useParams( { strict: false } ) as { siteId?: string };
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const openSiteUrl = useOpenSiteUrl( site );
	const { customizeLinks, contentLinks, adminLink } = useCustomizeLinks( site );
	// No `onOpen`: last-used tracking belongs to the split-button menus.
	const destinations = useOpenInDestinations( site );
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const [ deleteOpen, setDeleteOpen ] = useState( false );

	const busy = isStarting || isStopping;
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;

	const linkItem = ( link: CustomizeLink ) => (
		<QuickMenuItem
			key={ link.id }
			icon={ link.icon }
			label={ link.label }
			disabled={ busy }
			onClick={ () => void openSiteUrl( link.url ) }
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
					<Menu.Item disabled={ copySite.isPending } onClick={ () => copySite.mutate( site.id ) }>
						{ __( 'Duplicate' ) }
					</Menu.Item>
					<Menu.Item disabled={ isExporting } onClick={ () => exportFullSite.mutate( site.id ) }>
						{ __( 'Export' ) }
					</Menu.Item>
					<Menu.Item disabled={ isExporting } onClick={ () => exportDatabase.mutate( site.id ) }>
						{ __( 'Export DB' ) }
					</Menu.Item>
					<Menu.Separator />
					<Menu.Item className={ styles.destructiveItem } onClick={ () => setDeleteOpen( true ) }>
						{ __( 'Delete' ) }
					</Menu.Item>
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
