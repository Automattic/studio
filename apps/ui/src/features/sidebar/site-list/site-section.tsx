import { useNavigate } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { sitePinKey } from '@/data/queries/use-sidebar-pins';
import { useIsSiteStarting, useIsSiteStopping, useSiteOperation } from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useOpenSite } from '@/data/use-open-site';
import { resumeChat } from '@/features/sidebar/last-visited';
import { SidebarButton } from '@/features/sidebar/sidebar-button';
import { XdebugIcon } from '@/features/sidebar/xdebug-icon';
import { GlobeIcon, NewChatIcon } from '@/lib/icons';
import { IconButton } from '@/lib/ui';
import { useRowPressed, useSelectableRow } from './selection';
import { SiteAgentActivityIndicator } from './site-activity-indicator';
import { SiteChats } from './site-chats';
import { SiteRowMenu } from './site-row-menu';
import { getSiteStatus } from './site-status';
import { SiteStatusButton } from './site-status-button';
import styles from './style.module.css';
import type { SiteRow } from './sidebar-collections';
import type { AiSessionSummary } from '@/data/core';

export function SiteSection( {
	row,
	chats,
	isChatActive,
	isContextActive,
	chatEnabled,
	activeSessionId,
	expanded,
	loadError,
	reorderable,
	onOpen,
	onReorderChats,
	onSiteOpen,
}: {
	row: SiteRow;
	// The site's chats listed under its row, in order.
	chats: AiSessionSummary[];
	isChatActive: boolean;
	isContextActive: boolean;
	chatEnabled: boolean;
	activeSessionId?: string;
	// Lists the site's chats under its row.
	expanded: boolean;
	loadError: boolean;
	reorderable: boolean;
	// Clicking the row, before it opens the site; folds or unfolds its chats.
	onOpen?: () => void;
	onReorderChats: ( ids: string[] ) => void;
	onSiteOpen?: () => void;
} ) {
	const { site } = row;
	const selectable = useSelectableRow( sitePinKey( site.id ) );
	const pressed = useRowPressed( sitePinKey( site.id ) );
	const navigate = useNavigate();
	const sectionRef = useRef< HTMLElement >( null );
	const isActive = isChatActive || isContextActive;
	// Users who switched Studio Code off use the site's own page as its home.
	const isSelected = isChatActive || ( isContextActive && ! chatEnabled );
	const showContextOutline = isContextActive && chatEnabled;
	const showChats = expanded && chatEnabled && ( chats.length > 0 || loadError );
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
	const handleOpenSite = () => {
		onOpen?.();
		onSiteOpen?.();
		openSite( site, resumeChat( site.id, row.chats ) );
	};

	return (
		<section
			ref={ sectionRef }
			className={ clsx(
				styles.site,
				isSelected && styles.siteActive,
				showContextOutline && styles.siteContextActive,
				showChats && styles.siteWithChats
			) }
		>
			<SiteRowMenu
				site={ site }
				onSiteOpen={ onSiteOpen }
				trigger={
					<header { ...selectable } className={ styles.siteHeader } onClick={ handleOpenSite }>
						<span
							className={ styles.siteIcon }
							role={ site.enableXdebug ? 'img' : undefined }
							aria-label={ site.enableXdebug ? __( 'Xdebug enabled' ) : undefined }
						>
							{ site.enableXdebug ? <XdebugIcon className={ styles.siteXdebug } /> : <GlobeIcon /> }
							{ status === 'running' ? <span className={ styles.runningDot } /> : null }
						</span>
						<div className={ styles.siteText }>
							<SiteAgentActivityIndicator activity={ displayActivity } />
							<SidebarButton
								className={ styles.siteToggle }
								onClick={ ( event ) => {
									event.stopPropagation();
									handleOpenSite();
								} }
								aria-current={ isSelected ? 'page' : undefined }
								aria-pressed={ pressed }
								aria-expanded={ onOpen && chats.length > 0 ? showChats : undefined }
							>
								<span
									className={ clsx(
										styles.siteName,
										status === 'transitioning' && 'studio-shimmer'
									) }
								>
									{ site.name }
								</span>
							</SidebarButton>
						</div>
						<div className={ styles.siteActions } data-reorder-exclude>
							{ chatEnabled ? (
								<IconButton
									variant="muted-ghost"
									size="icon-sm"
									icon={ <NewChatIcon /> }
									label={ sprintf( __( 'New chat for %s' ), site.name ) }
									className={ styles.rowAction }
									onClick={ ( event ) => {
										event.stopPropagation();
										onSiteOpen?.();
										void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
									} }
								/>
							) : null }
							<SiteStatusButton
								site={ site }
								isStarting={ isStarting }
								isStopping={ isStopping }
								onStart={ isActive ? undefined : handleOpenSite }
							/>
						</div>
					</header>
				}
			/>
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
		</section>
	);
}
