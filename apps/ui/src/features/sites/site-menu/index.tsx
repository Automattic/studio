import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { aiSessionBelongsToSite } from '@studio/agent/protocol/sessions/owner-site';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { displayShortcut } from '@wordpress/keycodes';
import { useRef, useState } from 'react';
import { useSessionsBusy } from '@/data/agent-runs/use-agent-run';
import { useConnector } from '@/data/core';
import { useSessions } from '@/data/queries/use-sessions';
import { sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useSiteDesign } from '@/data/queries/use-site-design';
import { useIsSiteBusy, useSites, useStartSite, useStopSite } from '@/data/queries/use-sites';
import { useOpenSettings } from '@/data/use-open-settings';
import { useSessionPreviewUI } from '@/data/use-session-ui';
import { SiteShareMenuItem } from '@/features/sharing';
import { DeleteSiteDialog } from '@/features/sites/delete-site-dialog';
import { getSiteUrl } from '@/features/sites/get-site-url';
import {
	ImportSiteDialog,
	IMPORT_FILE_ACCEPT,
	useSiteBackupImport,
} from '@/features/sites/import-site-dialog';
import { useOpenInDestinations } from '@/features/sites/open-in-menu/use-open-in-destinations';
import {
	DATABASE_HOME_PATH,
	EMAIL_PREVIEW_PATH,
	getRealmNavigationPath,
} from '@/features/sites/site-preview/address-bar';
import { useItemShortcuts } from '@/features/sites/use-item-shortcuts';
import {
	useSiteManagementActions,
	type SiteManagementAction,
	type SiteManagementActionId,
} from '@/features/sites/use-site-management-actions';
import { SitePublishMenu } from '@/features/sync';
import {
	AppearanceIcon,
	ArrowRightIcon,
	ChevronDownIcon,
	DatabaseIcon,
	ExportIcon,
	ExternalLinkIcon,
	GlobeIcon,
	MailIcon,
	PinIcon,
	RenameIcon,
	RotateCwIcon,
	SiteSettingsIcon,
	StartSiteIcon,
	StopOtherSitesIcon,
	StopSiteIcon,
	UnpinIcon,
	WordPressIcon,
} from '@/lib/icons';
import { Tooltip, TooltipContent, TooltipTrigger, Menu, Button } from '@/lib/ui';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

/** Why the sites can't be deleted yet, if they can't: deleting stops their chats and operations. */
export function useDeleteBlockedReason( sites: SiteDetails[], sitesBusy: boolean ) {
	const { data: sessions } = useSessions();
	const chatsBusy = useSessionsBusy(
		( sessions ?? [] )
			.filter( ( session ) => sites.some( ( site ) => aiSessionBelongsToSite( session, site ) ) )
			.map( ( session ) => session.id )
	);
	if ( chatsBusy ) {
		return __( 'Wait for active chats and queued prompts to finish.' );
	}
	return sitesBusy ? __( 'Wait for site operations to finish.' ) : undefined;
}

// State for the menu's dialogs, which outlive the menu that opens them, and
// the actions the menu shares with the command palette. `onStart` follows a
// start, as the sidebar row's start button opens the site it starts.
export function useSiteActions(
	site: SiteDetails,
	{ onOpen, onStart }: { onOpen?: () => void; onStart?: () => void } = {}
) {
	const connector = useConnector();
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const preview = useSessionPreviewUI();
	const { data: sites } = useSites();
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const busy = useIsSiteBusy( site );
	const { isPinned, togglePin } = useSidebarPins();
	const [ deleteOpen, setDeleteOpen ] = useState( false );
	const importInputRef = useRef< HTMLInputElement >( null );
	const backupImport = useSiteBackupImport( site );
	const running = ( sites ?? [] ).filter( ( candidate ) => candidate.running );
	const othersRunning = running.filter( ( candidate ) => candidate.id !== site.id );

	const openSiteSettings = ( focus?: string ) => {
		onOpen?.();
		void connector.trackEvent( TRACKS_EVENTS.PANEL_OPENED, { panel: 'settings' } );
		openSettings( 'site', site.id, focus );
	};
	const rename = () => openSiteSettings( __( 'Site name' ) );
	const togglePinned = () => togglePin( sitePinKey( site.id ) );
	const toggleRunning = () => {
		if ( site.running ) {
			stopSite.mutate( site.id );
			return;
		}
		startSite.mutate( site.id );
		onStart?.();
	};
	const shortcuts = useItemShortcuts( {
		rename,
		pin: togglePinned,
		lifecycle: busy ? undefined : toggleRunning,
	} );

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

	return {
		site,
		busy,
		running,
		othersRunning,
		shortcuts,
		openSiteSettings: () => openSiteSettings(),
		rename,
		pinned: isPinned( sitePinKey( site.id ) ),
		togglePin: togglePinned,
		toggleRunning,
		stop: ( stopping: SiteDetails[] ) =>
			stopping.forEach( ( candidate ) => stopSite.mutate( candidate.id ) ),
		restart: () =>
			stopSite.mutateAsync( site.id ).then(
				() => startSite.mutate( site.id ),
				() => undefined
			),
		openAdmin: () => void goTo( '/wp-admin/' ),
		openDatabase: () => void goTo( DATABASE_HOME_PATH ),
		openEmail: () => void goTo( EMAIL_PREVIEW_PATH ),
		openDesignSystem: () => void goTo( DESIGN_SYSTEM_PREVIEW_PATH ),
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

export function SiteMenuItems( {
	actions,
	current = false,
}: {
	actions: SiteActions;
	// The menu of the current site, which ⌥⌘S starts or stops.
	current?: boolean;
} ) {
	const { site, busy, running, othersRunning } = actions;
	const siteDesign = useSiteDesign( site );
	const destinations = useOpenInDestinations( site );
	const manage = Object.fromEntries(
		useSiteManagementActions( site, {
			onDelete: actions.openDelete,
			onImport: actions.openImport,
		} ).map( ( action ) => [ action.id, action ] )
	) as Record< SiteManagementActionId, SiteManagementAction >;
	const deleteBlocked = useDeleteBlockedReason( [ site ], busy );
	const lifecycleShortcut = current ? (
		<Menu.Shortcut>{ displayShortcut.primaryAlt( 's' ) }</Menu.Shortcut>
	) : null;

	const manageItem = ( action: SiteManagementAction, label = action.label, blocked = false ) => (
		<Menu.Item
			disabled={ action.disabled || blocked }
			destructive={ action.destructive }
			onClick={ action.run }
		>
			<action.icon />
			{ label }
		</Menu.Item>
	);

	return (
		<div className={ styles.items }>
			<Menu.Item onClick={ actions.openSiteSettings }>
				<SiteSettingsIcon />
				{ __( 'Settings' ) }
			</Menu.Item>
			<Menu.Separator />
			{ site.running ? null : (
				<Menu.Item disabled={ busy } onClick={ actions.toggleRunning }>
					<StartSiteIcon />
					{ __( 'Start site' ) }
					{ lifecycleShortcut }
				</Menu.Item>
			) }
			{ site.running || running.length > 1 ? (
				<Menu.SubmenuRoot>
					<Menu.SubmenuTrigger disabled={ busy }>
						<StopSiteIcon />
						{ __( 'Stop' ) }
					</Menu.SubmenuTrigger>
					<Menu.SubmenuPopup { ...actions.shortcuts }>
						{ site.running ? (
							<Menu.Item onClick={ actions.toggleRunning }>
								<StopSiteIcon />
								{ __( 'Stop site' ) }
								{ lifecycleShortcut }
							</Menu.Item>
						) : null }
						{ site.running && othersRunning.length ? (
							<Menu.Item onClick={ () => actions.stop( othersRunning ) }>
								<StopOtherSitesIcon />
								{ __( 'Stop other sites' ) }
							</Menu.Item>
						) : null }
						{ running.length > 1 ? (
							<Menu.Item onClick={ () => actions.stop( running ) }>
								<StopOtherSitesIcon />
								{ __( 'Stop all sites' ) }
							</Menu.Item>
						) : null }
					</Menu.SubmenuPopup>
				</Menu.SubmenuRoot>
			) : null }
			{ site.running ? (
				<Menu.Item disabled={ busy } onClick={ () => void actions.restart() }>
					<RotateCwIcon />
					{ __( 'Restart site' ) }
				</Menu.Item>
			) : null }
			<Menu.Separator />
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger disabled={ busy }>
					<ArrowRightIcon />
					{ __( 'Go to' ) }
				</Menu.SubmenuTrigger>
				<Menu.SubmenuPopup>
					<Menu.Item onClick={ actions.openAdmin }>
						<WordPressIcon />
						{ __( 'WordPress Admin' ) }
					</Menu.Item>
					<Menu.Item onClick={ actions.openDatabase }>
						<DatabaseIcon />
						{ __( 'Database' ) }
					</Menu.Item>
					<Menu.Item onClick={ actions.openEmail }>
						<MailIcon />
						{ __( 'Email' ) }
					</Menu.Item>
					{ siteDesign.data ? (
						<Menu.Item onClick={ actions.openDesignSystem }>
							<AppearanceIcon />
							{ __( 'Design system' ) }
						</Menu.Item>
					) : null }
				</Menu.SubmenuPopup>
			</Menu.SubmenuRoot>
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger>
					<ExternalLinkIcon />
					{ __( 'Open in' ) }
				</Menu.SubmenuTrigger>
				<Menu.SubmenuPopup>
					{ destinations.map( ( destination ) => (
						<Menu.Item
							key={ destination.id }
							disabled={ destination.disabled }
							onClick={ destination.open }
						>
							{ destination.logo }
							{ destination.label }
						</Menu.Item>
					) ) }
				</Menu.SubmenuPopup>
			</Menu.SubmenuRoot>
			<Menu.Separator />
			<Menu.Item onClick={ actions.togglePin }>
				{ actions.pinned ? <UnpinIcon /> : <PinIcon /> }
				{ actions.pinned ? __( 'Unpin' ) : __( 'Pin' ) }
				<Menu.Shortcut>{ displayShortcut.primaryAlt( 'p' ) }</Menu.Shortcut>
			</Menu.Item>
			<Menu.Item onClick={ actions.rename }>
				<RenameIcon />
				{ __( 'Rename' ) }
				<Menu.Shortcut>{ displayShortcut.primaryAlt( 'r' ) }</Menu.Shortcut>
			</Menu.Item>
			{ manageItem( manage.import ) }
			<Menu.SubmenuRoot>
				<Menu.SubmenuTrigger disabled={ manage.export.disabled && manage[ 'export-db' ].disabled }>
					<ExportIcon />
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
			{ manageItem( manage.delete, __( 'Delete site' ), !! deleteBlocked ) }
		</div>
	);
}

// The site's control in the top band: a globe and a chevron.
export function SiteMenu( { site }: { site: SiteDetails } ) {
	const actions = useSiteActions( site );
	const label = __( 'Site menu' );
	return (
		<>
			<Menu.Root modal={ false }>
				<Tooltip>
					<Menu.Trigger
						render={
							<TooltipTrigger
								render={
									<Button
										variant="ghost"
										aria-label={ label }
										aria-busy={ actions.busy || undefined }
										className={ styles.trigger }
										{ ...actions.shortcuts }
										data-item-shortcuts-active="site"
									/>
								}
							/>
						}
					>
						<GlobeIcon data-icon="inline-start" />
						<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
					</Menu.Trigger>
					<TooltipContent side="bottom">{ label }</TooltipContent>
				</Tooltip>
				<Menu.Popup side="bottom" align="start" { ...actions.shortcuts }>
					<SiteMenuItems actions={ actions } current />
				</Menu.Popup>
			</Menu.Root>
			{ actions.dialogs }
		</>
	);
}
