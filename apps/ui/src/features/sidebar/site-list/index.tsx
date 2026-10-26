import { sortSites } from '@studio/common/lib/sort-sites';
import { useParams, useRouterState } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useMemo, type ReactNode } from 'react';
import { useSessionsNeedingInput } from '@/data/agent-runs/use-agent-run';
import { useSessions } from '@/data/queries/use-sessions';
import { useSidebarPreferences } from '@/data/queries/use-sidebar-pins';
import { useSites, useUpdateSitesSortOrder } from '@/data/queries/use-sites';
import { getSessionTitle } from '@/features/chats';
import { useOpenAddSite } from '@/features/sites';
import { CollapseAllIcon, PlusIcon } from '@/lib/icons';
import {
	IconButton,
	SidebarGroup,
	SidebarGroupHeader,
	SidebarGroupLabelSkeleton,
	SidebarMenu,
	SidebarMenuItem,
	SidebarMenuSkeleton,
} from '@/lib/ui';
import { ChatRow, RetryLoadingChats } from './chat-row';
import { useProvideCollapseAll } from './collapse-all';
import { SidebarSelection } from './selection';
import {
	createSiteRows,
	getActiveSiteKeys,
	getListedSessions,
	getSidebarCollections,
	hasSeveralUnfoldedSites,
	type SiteRow,
} from './sidebar-collections';
import { SiteListGroup } from './sidebar-group';
import { SidebarReorderableList } from './sidebar-reorderable-list';
import { SiteSection } from './site-section';
import styles from './style.module.css';
import { useRevealedSites } from './use-revealed-sites';
import type { AiSessionSummary } from '@/data/core';
import type { ReorderableItemProps } from '@/features/sidebar/reorderable-list';

export function SiteList( {
	active = true,
	className,
	onSiteOpen,
	reorderable = true,
	sections = false,
}: {
	className?: string;
	active?: boolean;
	onSiteOpen?: () => void;
	/** Whether site and chat rows can be reordered. */
	reorderable?: boolean;
	/** The sidebar groups sites, with their chats, and recent chats. */
	sections?: boolean;
} ) {
	const openAddSite = useOpenAddSite();
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: allSessions, isLoading: sessionsLoading, isError: sessionsError } = useSessions();
	const needingInput = useSessionsNeedingInput();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const activeSessionId = params.sessionId;
	const sessions = useMemo(
		() => getListedSessions( allSessions, activeSessionId ),
		[ allSessions, activeSessionId ]
	);
	const activeSiteId = params.siteId;
	const updateSitesSortOrder = useUpdateSitesSortOrder();
	const { pins, chatOrder, showRecentChats, autoCollapseSites, save } = useSidebarPreferences();

	const orderedSites = useMemo( () => sortSites( [ ...( sites ?? [] ) ] ), [ sites ] );
	const rows = useMemo(
		() => createSiteRows( orderedSites, sessions ),
		[ orderedSites, sessions ]
	);
	const { chat: activeChatSiteKey, context: activeContextSiteKey } = useMemo(
		() => getActiveSiteKeys( rows, { activeSessionId, activeSiteId, pathname } ),
		[ activeSessionId, activeSiteId, pathname, rows ]
	);
	const activeSiteKey = activeChatSiteKey ?? activeContextSiteKey;
	const { revealed, collapseAll, fold, toggle } = useRevealedSites(
		activeSiteKey,
		autoCollapseSites
	);

	const { pinnedItems, siteRows, chatsBySite, needsInputChats, recentChats } =
		getSidebarCollections( rows, sessions, {
			pins: sections ? pins : [],
			chatOrder,
			needingInput,
		} );

	const renderSiteRow = ( row: SiteRow, itemProps?: ReorderableItemProps ) => (
		<SiteSection
			key={ row.site.id }
			itemProps={ itemProps }
			row={ row }
			chats={ chatsBySite.get( row.site.id ) ?? [] }
			isChatActive={ row.site.id === activeChatSiteKey }
			isContextActive={ row.site.id === activeContextSiteKey }
			activeSessionId={ activeSessionId }
			expanded={ sections && revealed.has( row.site.id ) }
			loadError={ sessionsError }
			reorderable={ reorderable }
			onOpen={ sections ? () => toggle( row.site.id ) : undefined }
			onReorderChats={ ( ids ) =>
				save(
					{ sidebarChatOrder: { ...chatOrder, [ row.site.id ]: ids } },
					__( 'Couldn’t save the chat order' )
				)
			}
			onSiteOpen={ onSiteOpen }
		/>
	);

	let listContent: ReactNode;
	if ( sitesLoading ) {
		listContent = (
			<SidebarMenu aria-hidden="true">
				{ [ '65%', '48%', '72%', '56%' ].map( ( width ) => (
					<SidebarMenuItem key={ width }>
						<SidebarMenuSkeleton width={ width } />
					</SidebarMenuItem>
				) ) }
			</SidebarMenu>
		);
	} else if ( rows.length === 0 ) {
		listContent = sections ? null : <p className={ styles.empty }>{ __( 'No sites yet' ) }</p>;
	} else if ( ! reorderable ) {
		listContent = <SidebarMenu>{ siteRows.map( ( row ) => renderSiteRow( row ) ) }</SidebarMenu>;
	} else {
		listContent = (
			<SidebarReorderableList
				items={ siteRows }
				getItemId={ ( row ) => row.site.id }
				getItemLabel={ ( row ) => row.site.name }
				renderItem={ renderSiteRow }
				onReorder={ ( ids ) => updateSitesSortOrder.mutate( ids ) }
				onDragStart={ ( row ) => fold( [ row.site.id ] ) }
			/>
		);
	}

	const canCollapseAll = sections && hasSeveralUnfoldedSites( siteRows, chatsBySite, revealed );
	useProvideCollapseAll( active && canCollapseAll ? collapseAll : undefined );

	if ( ! sections ) {
		return <div className={ clsx( styles.root, className ) }>{ listContent }</div>;
	}

	if ( sitesLoading ) {
		return (
			<div className={ clsx( styles.root, className ) }>
				<SidebarGroup>
					<SidebarGroupHeader aria-hidden="true">
						<SidebarGroupLabelSkeleton />
					</SidebarGroupHeader>
					{ listContent }
				</SidebarGroup>
			</div>
		);
	}

	const loaded = ! sitesLoading && ! sessionsLoading;
	const renderChat = (
		session: AiSessionSummary,
		siteName?: string,
		itemProps?: ReorderableItemProps
	) => (
		<ChatRow
			key={ session.id }
			itemProps={ itemProps }
			session={ session }
			active={ session.id === activeSessionId }
			siteName={ siteName }
			onOpen={ onSiteOpen }
		/>
	);

	return (
		<div className={ clsx( styles.root, className ) }>
			<SidebarSelection>
				{ needsInputChats.length > 0 ? (
					<SiteListGroup id="needs-input" title={ __( 'Needs input' ) } foldable={ false }>
						<SidebarMenu>
							{ needsInputChats.map( ( session ) => renderChat( session ) ) }
						</SidebarMenu>
					</SiteListGroup>
				) : null }
				<SiteListGroup
					id="pinned"
					title={ __( 'Pinned' ) }
					hidden={ pinnedItems.length === 0 }
					itemKeys={ loaded ? pinnedItems.map( ( item ) => item.key ) : undefined }
					onFold={ () =>
						fold( pinnedItems.flatMap( ( item ) => ( item.row ? [ item.row.site.id ] : [] ) ) )
					}
					action={
						<IconButton
							variant="muted-ghost"
							size="icon-sm"
							icon={ <PlusIcon /> }
							label={ __( 'Add pinned site' ) }
							onClick={ () => openAddSite( 'create', { pin: true } ) }
						/>
					}
				>
					<SidebarReorderableList
						items={ pinnedItems }
						getItemId={ ( item ) => item.key }
						getItemLabel={ ( item ) =>
							item.row ? item.row.site.name : getSessionTitle( item.session )
						}
						renderItem={ ( item, itemProps ) =>
							item.row
								? renderSiteRow( item.row, itemProps )
								: renderChat( item.session, item.siteName, itemProps )
						}
						onReorder={ ( sidebarPins ) => save( { sidebarPins } ) }
						onDragStart={ ( item ) => item.row && fold( [ item.row.site.id ] ) }
					/>
				</SiteListGroup>
				<SiteListGroup
					id="sites"
					title={ __( 'Sites' ) }
					itemKeys={ loaded ? siteRows.map( ( row ) => row.site.id ) : undefined }
					onFold={ () => fold( siteRows.map( ( row ) => row.site.id ) ) }
					foldable={ sitesLoading || siteRows.length > 0 }
					action={
						<>
							{ canCollapseAll ? (
								<IconButton
									variant="muted-ghost"
									size="icon-sm"
									icon={ <CollapseAllIcon /> }
									label={ __( 'Collapse all' ) }
									onClick={ collapseAll }
								/>
							) : null }
							<IconButton
								variant="muted-ghost"
								size="icon-sm"
								icon={ <PlusIcon /> }
								label={ __( 'Add site' ) }
								onClick={ () => openAddSite() }
							/>
						</>
					}
				>
					{ listContent }
				</SiteListGroup>
				{ showRecentChats ? (
					<SiteListGroup
						id="recent"
						title={ __( 'Recent' ) }
						hidden={ recentChats.length === 0 && ! sessionsError }
						itemKeys={ loaded ? recentChats.map( ( session ) => session.id ) : undefined }
					>
						<SidebarMenu>
							{ sessionsError ? (
								<RetryLoadingChats />
							) : (
								recentChats.map( ( session ) => renderChat( session ) )
							) }
						</SidebarMenu>
					</SiteListGroup>
				) : null }
			</SidebarSelection>
		</div>
	);
}
