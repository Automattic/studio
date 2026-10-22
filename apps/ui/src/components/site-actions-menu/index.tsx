import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import {
	arrowRight,
	arrowUpRight,
	chevronDownSmall,
	Icon,
	settings,
	wordpress,
} from '@wordpress/icons';
import { displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { useRef, useState } from 'react';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import {
	ImportSiteDialog,
	IMPORT_FILE_ACCEPT,
	useSiteBackupImport,
} from '@/components/import-site-dialog';
import * as Menu from '@/components/menu';
import { useOpenInDestinations } from '@/components/open-in-menu/use-open-in-destinations';
import { SitePublishMenu } from '@/components/publish-panel/publish-menu';
import { SiteShareMenuItem } from '@/components/share-dialog/share-menu-item';
import { DATABASE_HOME_PATH, getRealmNavigationPath } from '@/components/site-preview/address-bar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConnector } from '@/data/core';
import { sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useIsSiteBusy, useSites, useStartSite, useStopSite } from '@/data/queries/use-sites';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { useSessionPreviewUI } from '@/hooks/use-session-ui';
import {
	useSiteManagementActions,
	type SiteManagementAction,
	type SiteManagementActionId,
} from '@/hooks/use-site-management-actions';
import { getSiteUrl } from '@/lib/get-site-url';
import {
	databaseIcon,
	globeIcon,
	pinIcon,
	refreshIcon,
	renameIcon,
	startSiteIcon,
	stopSiteIcon,
	unpinIcon,
} from '@/lib/icons';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

// State for the menu's dialogs, which outlive the menu that opens them.
export function useSiteActions( site: SiteDetails, { onOpen }: { onOpen?: () => void } = {} ) {
	const connector = useConnector();
	const openSettings = useOpenSettings();
	const { isPinned, togglePin } = useSidebarPins();
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const importInputRef = useRef< HTMLInputElement >( null );
	const backupImport = useSiteBackupImport( site );

	const openSiteSettings = ( focus?: string ) => {
		onOpen?.();
		void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: 'settings' } );
		openSettings( 'site', site.id, focus );
	};
	const rename = () => openSiteSettings( __( 'Site name' ) );

	// ⌥⌘P pins and ⌥⌘R renames (Ctrl+Alt elsewhere).
	const handleShortcut = ( event: KeyboardEvent ) => {
		if ( isKeyboardEvent.primaryAlt( event, 'p' ) ) {
			event.preventDefault();
			togglePin( sitePinKey( site.id ) );
		} else if ( isKeyboardEvent.primaryAlt( event, 'r' ) ) {
			event.preventDefault();
			rename();
		}
	};

	return {
		site,
		handleShortcut,
		openSiteSettings: () => openSiteSettings(),
		rename,
		pinned: isPinned( sitePinKey( site.id ) ),
		togglePin: () => togglePin( sitePinKey( site.id ) ),
		openImport: () => importInputRef.current?.click(),
		openDelete: () => setDeleteOpen( true ),
		dialogs: (
			<>
				<input
					ref={ importInputRef }
					type="file"
					hidden
					accept={ IMPORT_FILE_ACCEPT }
					data-testid="import-backup-file"
					onChange={ ( event ) => {
						backupImport.selectFile( event.target.files?.[ 0 ] );
						// Lets the same file be picked again after a cancel or a failure.
						event.target.value = '';
					} }
				/>
				<ImportSiteDialog
					site={ site }
					file={ backupImport.file }
					open={ backupImport.isConfirming }
					onCancel={ backupImport.cancel }
					onConfirm={ () => void backupImport.confirm() }
				/>
				<DeleteSiteDialog sites={ [ site ] } open={ deleteOpen } onOpenChange={ setDeleteOpen } />
			</>
		),
	};
}

type SiteActions = ReturnType< typeof useSiteActions >;

export function SiteActionsMenuItems( { actions }: { actions: SiteActions } ) {
	const { site } = actions;
	const navigate = useNavigate();
	const preview = useSessionPreviewUI();
	const { data: sites } = useSites();
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const busy = useIsSiteBusy( site );
	const destinations = useOpenInDestinations( site );
	const manage = Object.fromEntries(
		useSiteManagementActions( site, {
			onDelete: actions.openDelete,
			onImport: actions.openImport,
		} ).map( ( action ) => [ action.id, action ] )
	) as Record< SiteManagementActionId, SiteManagementAction >;
	const running = ( sites ?? [] ).filter( ( candidate ) => candidate.running );
	const othersRunning = running.filter( ( candidate ) => candidate.id !== site.id );

	const restart = () =>
		stopSite.mutateAsync( site.id ).then(
			() => startSite.mutate( site.id ),
			() => undefined
		);

	// Shows the page in this site's preview, starting the site first.
	const goTo = async ( path: string ) => {
		if ( ! site.running && ! ( await startSite.mutateAsync( site.id ).catch( () => false ) ) ) {
			return;
		}
		preview.setSite( site.id );
		preview.updatePath( getRealmNavigationPath( path, getSiteUrl( site ) ) );
		preview.setOpen( true );
		if ( preview.siteId !== site.id ) {
			void navigate( { to: '/sites/$siteId', params: { siteId: site.id } } );
		}
	};

	const manageItem = ( action: SiteManagementAction, label = action.label ) => (
		<Menu.Item
			disabled={ action.disabled }
			destructive={ action.destructive }
			onClick={ action.run }
		>
			<Icon icon={ action.icon } />
			{ label }
		</Menu.Item>
	);

	return (
		<div className={ styles.items }>
			<Menu.Item onClick={ actions.openSiteSettings }>
				<Icon icon={ settings } />
				{ __( 'Settings' ) }
			</Menu.Item>
			<Menu.Separator />
			{ site.running ? null : (
				<Menu.Item disabled={ busy } onClick={ () => startSite.mutate( site.id ) }>
					<Icon icon={ startSiteIcon } />
					{ __( 'Start site' ) }
				</Menu.Item>
			) }
			{ site.running || running.length > 1 ? (
				<Menu.SubmenuRoot>
					<Menu.SubmenuTrigger disabled={ busy }>
						<Icon icon={ stopSiteIcon } />
						{ __( 'Stop' ) }
					</Menu.SubmenuTrigger>
					<Menu.SubmenuPopup>
						{ site.running ? (
							<Menu.Item onClick={ () => stopSite.mutate( site.id ) }>
								<Icon icon={ stopSiteIcon } />
								{ __( 'Stop site' ) }
							</Menu.Item>
						) : null }
						{ site.running && othersRunning.length ? (
							<Menu.Item
								onClick={ () => othersRunning.forEach( ( other ) => stopSite.mutate( other.id ) ) }
							>
								<Icon icon={ stopSiteIcon } />
								{ __( 'Stop other sites' ) }
							</Menu.Item>
						) : null }
						{ running.length > 1 ? (
							<Menu.Item
								onClick={ () => running.forEach( ( each ) => stopSite.mutate( each.id ) ) }
							>
								<Icon icon={ stopSiteIcon } />
								{ __( 'Stop all sites' ) }
							</Menu.Item>
						) : null }
					</Menu.SubmenuPopup>
				</Menu.SubmenuRoot>
			) : null }
			{ site.running ? (
				<Menu.Item disabled={ busy } onClick={ () => void restart() }>
					<Icon icon={ refreshIcon } />
					{ __( 'Restart site' ) }
				</Menu.Item>
			) : null }
			<Menu.Separator />
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger disabled={ busy }>
					<Icon icon={ arrowRight } />
					{ __( 'Go to' ) }
				</Menu.SubmenuTrigger>
				<Menu.SubmenuPopup>
					<Menu.Item onClick={ () => void goTo( '/wp-admin/' ) }>
						<Icon icon={ wordpress } />
						{ __( 'WordPress Admin' ) }
					</Menu.Item>
					<Menu.Item onClick={ () => void goTo( DATABASE_HOME_PATH ) }>
						<Icon icon={ databaseIcon } />
						{ __( 'Database' ) }
					</Menu.Item>
				</Menu.SubmenuPopup>
			</Menu.SubmenuRoot>
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger>
					<Icon icon={ arrowUpRight } />
					{ __( 'Open in' ) }
				</Menu.SubmenuTrigger>
				<Menu.SubmenuPopup>
					{ destinations.map( ( destination ) => (
						<Menu.Item
							key={ destination.id }
							disabled={ destination.disabled }
							onClick={ destination.open }
						>
							<Icon icon={ destination.logo } />
							{ destination.label }
						</Menu.Item>
					) ) }
				</Menu.SubmenuPopup>
			</Menu.SubmenuRoot>
			<Menu.Separator />
			<Menu.Item onClick={ actions.togglePin }>
				<Icon icon={ actions.pinned ? unpinIcon : pinIcon } />
				{ actions.pinned ? __( 'Unpin' ) : __( 'Pin' ) }
				<Menu.Shortcut>{ displayShortcut.primaryAlt( 'p' ) }</Menu.Shortcut>
			</Menu.Item>
			<Menu.Item onClick={ actions.rename }>
				<Icon icon={ renameIcon } />
				{ __( 'Rename' ) }
				<Menu.Shortcut>{ displayShortcut.primaryAlt( 'r' ) }</Menu.Shortcut>
			</Menu.Item>
			{ manageItem( manage.import ) }
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger>
					<Icon icon={ manage.export.icon } />
					{ __( 'Export' ) }
				</Menu.SubmenuTrigger>
				<Menu.SubmenuPopup>
					{ manageItem( manage.export, __( 'Export site' ) ) }
					{ manageItem( manage[ 'export-db' ] ) }
				</Menu.SubmenuPopup>
			</Menu.SubmenuRoot>
			{ manageItem( manage.duplicate ) }
			<Menu.Separator />
			<SiteShareMenuItem site={ site } disabled={ busy } />
			<SitePublishMenu site={ site } disabled={ busy } />
			<Menu.Separator />
			{ manageItem( manage.delete, __( 'Delete site' ) ) }
		</div>
	);
}

// The site's control in the top band: a globe and a chevron.
export function SiteActionsMenu( { site }: { site: SiteDetails } ) {
	const actions = useSiteActions( site );
	/* translators: %s: site name */
	const label = sprintf( __( 'Site actions for %s' ), site.name );
	return (
		<>
			<Menu.Root modal={ false }>
				<Tooltip>
					<Menu.Trigger
						render={
							<TooltipTrigger
								render={
									<Button variant="ghost" aria-label={ label } className={ styles.trigger } />
								}
							/>
						}
					>
						<Icon icon={ globeIcon } data-icon="inline-start" />
						<Icon icon={ chevronDownSmall } data-icon="inline-end" data-dropdown-indicator />
					</Menu.Trigger>
					<TooltipContent side="bottom">{ label }</TooltipContent>
				</Tooltip>
				<Menu.Popup
					side="bottom"
					align="start"
					onKeyDown={ ( event ) => actions.handleShortcut( event.nativeEvent ) }
				>
					<SiteActionsMenuItems actions={ actions } />
				</Menu.Popup>
			</Menu.Root>
			{ actions.dialogs }
		</>
	);
}
