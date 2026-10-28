import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { sitePinKey } from '@/data/queries/use-sidebar-pins';
import { useIsSiteStarting, useIsSiteStopping, useSiteOperation } from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useOpenSite } from '@/data/use-open-site';
import { useOptionalSessionPreviewUI } from '@/data/use-session-ui';
import { XdebugIcon } from '@/features/sidebar/xdebug-icon';
import { GlobeIcon, NewChatIcon } from '@/lib/icons';
import {
	IconButton,
	NotificationDot,
	SidebarMenuActions,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuLabel,
} from '@/lib/ui';
import { useRowPressed, useSelectableRow } from './selection';
import { SiteAgentActivityIndicator } from './site-activity-indicator';
import { SiteChats } from './site-chats';
import { SiteRowMenu } from './site-row-menu';
import { getSiteStatus } from './site-status';
import { SiteStatusButton } from './site-status-button';
import styles from './style.module.css';
import type { SiteRow } from './sidebar-collections';
import type { AiSessionSummary } from '@/data/core';
import type { ReorderableItemProps } from '@/features/sidebar/reorderable-list';

export function SiteSection( {
	row,
	chats,
	isChatActive,
	isContextActive,
	activeSessionId,
	expanded,
	loadError,
	reorderable,
	onOpen,
	onReorderChats,
	onSiteOpen,
	itemProps,
}: {
	row: SiteRow;
	// The site's chats listed under its row, in order.
	chats: AiSessionSummary[];
	isChatActive: boolean;
	isContextActive: boolean;
	activeSessionId?: string;
	// Lists the site's chats under its row.
	expanded: boolean;
	loadError: boolean;
	reorderable: boolean;
	// Clicking the row, before it opens the site; folds or unfolds its chats.
	onOpen?: () => void;
	onReorderChats: ( ids: string[] ) => void;
	onSiteOpen?: () => void;
	// Drag handling, when the row is in a reorderable list.
	itemProps?: ReorderableItemProps;
} ) {
	const { site } = row;
	const selectable = useSelectableRow( sitePinKey( site.id ) );
	const pressed = useRowPressed( sitePinKey( site.id ) );
	const navigate = useNavigate();
	const sectionRef = useRef< HTMLLIElement >( null );
	const isActive = isChatActive || isContextActive;
	const showChats = expanded && ( chats.length > 0 || loadError );
	// Highlighted, with its actions showing, unless its open chat is listed under it.
	const highlighted = ( isChatActive && ( ! showChats || ! activeSessionId ) ) || isContextActive;
	// Keep the active site visible — e.g. when launch restores a site that
	// sits below the sidebar's fold. `nearest` no-ops when already visible.
	useEffect( () => {
		if ( isActive ) {
			sectionRef.current?.scrollIntoView?.( { block: 'nearest' } );
		}
	}, [ isActive ] );
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const status = getSiteStatus( site, isStarting, isStopping, useSiteOperation( site ) );
	const syncActivity = useSiteSyncActivity( site.id );
	// Import gets a row indicator of its own alongside push/pull: it is the only
	// way to tell which site a long-running import belongs to when several are in
	// flight, and it is a local operation, so it doesn't read as "syncing".
	const pendingDirection = syncActivity?.kind === 'pending' ? syncActivity.direction : undefined;
	const siteActivity =
		pendingDirection === 'import'
			? 'import'
			: pendingDirection === 'push' || pendingDirection === 'pull'
			? 'sync'
			: undefined;
	const displayActivity = siteActivity ?? 'idle';
	const openSite = useOpenSite();
	const preview = useOptionalSessionPreviewUI();
	const handleOpenSite = () => {
		onOpen?.();
		onSiteOpen?.();
		openSite( site );
	};
	const handleStartSite = () => {
		if ( ! isActive ) {
			handleOpenSite();
		} else {
			preview?.setOpen( true );
			preview?.setChatHidden( false );
		}
	};

	return (
		<SidebarMenuItem
			{ ...itemProps }
			ref={ sectionRef }
			className={ clsx( styles.site, itemProps?.className ) }
		>
			<SiteRowMenu
				site={ site }
				onSiteOpen={ onSiteOpen }
				onStart={ handleStartSite }
				trigger={
					<SidebarMenuButton
						render={ <div /> }
						{ ...selectable }
						active={ highlighted }
						className={ styles.siteRow }
						onClick={ handleOpenSite }
					>
						<span
							role={ site.enableXdebug ? 'img' : undefined }
							aria-label={ site.enableXdebug ? __( 'Xdebug enabled' ) : undefined }
						>
							{ site.enableXdebug ? <XdebugIcon /> : <GlobeIcon /> }
							{ status === 'running' ? <NotificationDot position="icon" /> : null }
						</span>
						<div className={ styles.siteText }>
							<SiteAgentActivityIndicator activity={ displayActivity } />
							<SidebarMenuLabel
								render={ <button type="button" /> }
								className={ status === 'transitioning' ? 'studio-shimmer' : undefined }
								aria-current={ isChatActive ? 'page' : undefined }
								aria-pressed={ pressed }
								aria-expanded={ onOpen && chats.length > 0 ? showChats : undefined }
							>
								{ site.name }
							</SidebarMenuLabel>
						</div>
					</SidebarMenuButton>
				}
			/>
			<SidebarMenuActions
				showOnHover={ ! highlighted }
				className={ styles.siteActions }
				data-reorder-exclude
			>
				<IconButton
					variant="muted-ghost"
					size="icon-sm"
					icon={ <NewChatIcon /> }
					label={ sprintf( __( 'New chat for %s' ), site.name ) }
					onClick={ () => {
						onSiteOpen?.();
						void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
					} }
				/>
				<SiteStatusButton
					site={ site }
					isStarting={ isStarting }
					isStopping={ isStopping }
					onStart={ handleStartSite }
				/>
			</SidebarMenuActions>
			<SiteChats
				site={ site }
				chats={ chats }
				open={ showChats }
				expanded={ expanded }
				loadError={ loadError }
				reorderable={ reorderable }
				activeSessionId={ activeSessionId }
				onReorderChats={ onReorderChats }
				onSiteOpen={ onSiteOpen }
			/>
		</SidebarMenuItem>
	);
}
