import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { sortSites } from '@studio/common/lib/sort-sites';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { ChevronRightIcon } from 'lucide-react';
import {
	Fragment,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactElement,
	type ReactNode,
} from 'react';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import { ChatActionsMenuItems, useChatActions } from '@/components/chat-actions';
import { ReorderableList, type ReorderableListProps } from '@/components/reorderable-list';
import { getSessionTitle } from '@/components/session-view/session-chat-actions';
import { SidebarButton } from '@/components/sidebar-button';
import { SiteActionsMenuItems, useSiteActions } from '@/components/site-actions-menu';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { XdebugIcon } from '@/components/xdebug-icon';
import {
	useSessionsNeedingInput,
	useSiteAgentActivity,
	type SiteAgentActivity,
} from '@/data/queries/use-agent-run';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSessions } from '@/data/queries/use-sessions';
import {
	chatPinKey,
	orderChats,
	sitePinKey,
	useSidebarPreferences,
} from '@/data/queries/use-sidebar-pins';
import {
	useIsSiteBusy,
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteOperation,
	useSites,
	useStartSite,
	useStopSite,
	useUpdateSitesSortOrder,
} from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useOpenAddSite } from '@/hooks/use-open-add-site';
import { useOpenSite } from '@/hooks/use-open-site';
import { useStoredFlag } from '@/hooks/use-stored-flag';
import { ArchiveIcon } from '@/lib/icons/archive-icon';
import { ChatIcon } from '@/lib/icons/chat-icon';
import { CollapseAllIcon } from '@/lib/icons/collapse-all-icon';
import { GlobeIcon } from '@/lib/icons/globe-icon';
import { NeedsInputIcon } from '@/lib/icons/needs-input-icon';
import { NewChatIcon } from '@/lib/icons/new-chat-icon';
import { PinIcon } from '@/lib/icons/pin-icon';
import { PlusIcon } from '@/lib/icons/plus-icon';
import { StartSiteIcon } from '@/lib/icons/start-site-icon';
import { StopSiteIcon } from '@/lib/icons/stop-site-icon';
import { UnpinIcon } from '@/lib/icons/unpin-icon';
import { resumeChat } from '@/lib/last-visited';
import { useProvideCollapseAll } from './collapse-all';
import {
	BulkMenu,
	SidebarSelection,
	useIsBulkTarget,
	useIsSelecting,
	useSelectableRow,
} from './selection';
import { getSiteStatus, getSiteStatusName } from './site-status';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

type SiteRow = {
	site: SiteDetails;
	sessionIds: string[];
	// Non-archived, most recent first.
	chats: AiSessionSummary[];
};

// Chats listed at first under a site, and how many more each Show more adds.
const CHATS_INITIAL_COUNT = 5;
const CHATS_PAGE_SIZE = 10;
// Recent is a shortcut to the latest chats; every chat is also under its site.
const RECENT_CHATS_LIMIT = 10;

type SiteRowActivity = SiteAgentActivity | 'sync' | 'import';

const ACTIVITY_EXIT_DURATION_MS = 180;

function SiteAgentActivityTooltip( {
	label,
	ariaLabel = label,
	className,
	childProvidesLabel = false,
	children,
}: {
	label: string;
	ariaLabel?: string;
	className?: string;
	childProvidesLabel?: boolean;
	children?: ReactNode;
} ) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={ clsx(
							styles.siteAgentActivity,
							styles.siteAgentActivityTooltipTrigger,
							className
						) }
						role={ childProvidesLabel ? undefined : 'status' }
						aria-label={ childProvidesLabel ? undefined : ariaLabel }
					/>
				}
			>
				{ children }
			</TooltipTrigger>
			<TooltipContent>{ label }</TooltipContent>
		</Tooltip>
	);
}

function SiteAgentActivityIndicator( { activity }: { activity: SiteRowActivity } ) {
	const [ exitingActivity, setExitingActivity ] = useState< SiteRowActivity >( 'idle' );

	useEffect( () => {
		if ( activity !== 'idle' ) {
			setExitingActivity( activity );
			return;
		}

		const timeout = window.setTimeout(
			() => setExitingActivity( 'idle' ),
			ACTIVITY_EXIT_DURATION_MS
		);
		return () => window.clearTimeout( timeout );
	}, [ activity ] );

	const renderedActivity = activity === 'idle' ? exitingActivity : activity;
	const isVisible = activity !== 'idle';
	const workingLabel = __( 'Working…' );
	const pendingQuestionLabel = __( 'Needs an answer' );
	const pendingQuestionAriaLabel = __( 'Studio needs an answer.' );
	const syncLabel = __( 'Syncing live site' );
	const importLabel = __( 'Importing backup' );

	return (
		<span
			className={ clsx(
				styles.siteAgentActivitySlot,
				isVisible && styles.siteAgentActivitySlotVisible
			) }
			aria-hidden={ isVisible ? undefined : 'true' }
		>
			{ renderedActivity === 'working' ? (
				<SiteAgentActivityTooltip label={ workingLabel } childProvidesLabel>
					<AgentWorkingIndicator
						className={ styles.siteAgentActivityPixels }
						label={ workingLabel }
					/>
				</SiteAgentActivityTooltip>
			) : null }
			{ renderedActivity === 'pending-question' ? (
				<SiteAgentActivityTooltip
					label={ pendingQuestionLabel }
					ariaLabel={ pendingQuestionAriaLabel }
					className={ styles.siteAgentActivityQuestion }
				/>
			) : null }
			{ renderedActivity === 'sync' || renderedActivity === 'import' ? (
				<SiteAgentActivityTooltip
					label={ renderedActivity === 'import' ? importLabel : syncLabel }
					className={ styles.siteAgentActivitySync }
				>
					<span className={ styles.siteAgentActivitySyncDots } aria-hidden="true">
						<span className={ styles.siteAgentActivitySyncDot } />
						<span className={ styles.siteAgentActivitySyncDot } />
						<span className={ styles.siteAgentActivitySyncDot } />
					</span>
				</SiteAgentActivityTooltip>
			) : null }
		</span>
	);
}

function getTimestamp( session: AiSessionSummary | undefined ): number {
	return session ? Date.parse( session.updatedAt ) || 0 : 0;
}

function byMostRecent( a: AiSessionSummary, b: AiSessionSummary ): number {
	return getTimestamp( b ) - getTimestamp( a );
}

function createSiteRows(
	sites: SiteDetails[] | undefined,
	sessions: AiSessionSummary[] | undefined
): SiteRow[] {
	const rows: SiteRow[] = ( sites ?? [] ).map( ( site ) => ( {
		site,
		sessionIds: [],
		chats: [],
	} ) );
	const rowsBySiteId = new Map( rows.map( ( row ) => [ row.site.id, row ] ) );

	for ( const session of sessions ?? [] ) {
		const ownerSite = findAiSessionOwnerSite( sites, session );
		const row = ownerSite ? rowsBySiteId.get( ownerSite.id ) : undefined;
		if ( ! row ) {
			continue;
		}
		row.sessionIds.push( session.id );
		if ( ! session.archived ) {
			row.chats.push( session );
		}
	}

	for ( const row of rows ) {
		row.chats.sort( byMostRecent );
	}

	return rows;
}

// Overlays the just-dragged order (kept in state while the persisted
// `sortOrder` catches up) on top of the fetched sites; sites not in the
// overlay keep their order via sort stability.
function sortSitesByManualOrder( sites: SiteDetails[], manualOrder: string[] ): SiteDetails[] {
	// MAX_SAFE_INTEGER (not Infinity): two unranked sites must compare as 0,
	// not NaN, for the sort to be well-defined.
	const rank = new Map( manualOrder.map( ( id, index ) => [ id, index ] ) );
	return [ ...sites ].sort(
		( a, b ) =>
			( rank.get( a.id ) ?? Number.MAX_SAFE_INTEGER ) -
			( rank.get( b.id ) ?? Number.MAX_SAFE_INTEGER )
	);
}

// Opens a collapsed group when something is added to it, e.g. a new site.
// `keys` is undefined until the group's items have loaded.
function useOpenOnAddedItems( keys: string[] | undefined, open: boolean, onOpen: () => void ) {
	const previous = useRef< Set< string > | null >( null );
	useEffect( () => {
		if ( ! keys ) {
			return;
		}
		const known = previous.current;
		previous.current = new Set( keys );
		if ( known && ! open && keys.some( ( key ) => ! known.has( key ) ) ) {
			onOpen();
		}
	}, [ keys, open, onOpen ] );
}

// Rows hold still while several are selected, so a drag can't scatter them.
function SidebarReorderableList< T >(
	props: Pick<
		ReorderableListProps< T >,
		'items' | 'getItemId' | 'getItemLabel' | 'renderItem' | 'onReorder'
	>
) {
	return (
		<ReorderableList
			{ ...props }
			className={ styles.sites }
			itemClassName={ styles.siteDragWrapper }
			placeholderClassName={ styles.siteDropPlaceholder }
			previewClassName={ styles.siteDragPreview }
			excludeSelector="[data-reorder-exclude]"
			disabled={ useIsSelecting() }
		/>
	);
}

function RetryLoadingChats() {
	const { refetch } = useSessions();
	return (
		<SidebarButton
			className={ clsx( styles.chat, styles.mutedRow ) }
			onClick={ () => void refetch() }
		>
			<span className={ styles.chatTitle }>{ __( 'Retry loading chats' ) }</span>
		</SidebarButton>
	);
}

function ChatRow( {
	session,
	active,
	nested = false,
	siteName,
	onOpen,
}: {
	session: AiSessionSummary;
	active: boolean;
	// Under its site the row indents to the site's name and drops its icon.
	nested?: boolean;
	// Away from its site, the row names it in a tooltip.
	siteName?: string;
	onOpen?: () => void;
} ) {
	const navigate = useNavigate();
	const activity = useSiteAgentActivity( [ session.id ] );
	const actions = useChatActions( session, active );
	const selectable = useSelectableRow( chatPinKey( session.id ) );
	const bulk = useIsBulkTarget( chatPinKey( session.id ) );
	const [ menuOpen, setMenuOpen ] = useState( false );
	const title = getSessionTitle( session );
	const needsInput = activity === 'pending-question';

	const button = (
		<SidebarButton
			className={ styles.chat }
			aria-current={ active ? 'page' : undefined }
			onClick={ () => {
				onOpen?.();
				void navigate( {
					to: '/sessions/$sessionId',
					params: { sessionId: session.id },
				} );
			} }
		>
			{ nested ? null : <ChatIcon className={ styles.rowIcon } /> }
			<span className={ styles.chatTitle }>{ title }</span>
			{ actions.working ? (
				<AgentWorkingIndicator className={ styles.chatActivity } label={ __( 'Working…' ) } />
			) : null }
			{ needsInput ? (
				<Badge
					variant="accent"
					size="icon"
					role="status"
					aria-label={ __( 'Studio needs an answer.' ) }
				>
					<NeedsInputIcon />
				</Badge>
			) : null }
			{ session.unread && ! active ? (
				<span className={ styles.unreadDot } role="img" aria-label={ __( 'Unread' ) } />
			) : null }
		</SidebarButton>
	);

	return (
		<>
			<Menu.ContextMenuRoot open={ menuOpen } onOpenChange={ setMenuOpen }>
				<Menu.ContextMenuTrigger
					render={
						<div
							{ ...selectable }
							{ ...actions.shortcuts }
							className={ clsx(
								styles.chatRow,
								nested && styles.chatNested,
								active && styles.chatActive
							) }
						>
							{ siteName ? (
								<Tooltip>
									<TooltipTrigger render={ button } />
									<TooltipContent side="right">
										{ sprintf(
											/* translators: 1: chat title, 2: the chat's site. */
											__( '%1$s — %2$s' ),
											title,
											siteName
										) }
									</TooltipContent>
								</Tooltip>
							) : (
								button
							) }
							{ needsInput ? null : (
								<span className={ styles.chatActions } data-reorder-exclude>
									<IconButton
										variant="muted-ghost"
										size="icon-sm"
										icon={ actions.pinned ? <UnpinIcon /> : <PinIcon /> }
										label={ actions.pinned ? __( 'Unpin chat' ) : __( 'Pin chat' ) }
										onClick={ actions.togglePin }
									/>
									<IconButton
										variant="muted-ghost"
										size="icon-sm"
										icon={ <ArchiveIcon /> }
										label={ __( 'Archive chat' ) }
										disabled={ actions.archiveBlocked }
										onClick={ () => void actions.archive() }
									/>
								</span>
							) }
						</div>
					}
				/>
				{ bulk ? (
					<BulkMenu onClose={ () => setMenuOpen( false ) } />
				) : (
					<Menu.ContextPopup { ...actions.shortcuts }>
						<ChatActionsMenuItems actions={ actions } />
					</Menu.ContextPopup>
				) }
			</Menu.ContextMenuRoot>
			{ actions.renameDialog }
		</>
	);
}

function SidebarGroup( {
	id,
	title,
	action,
	itemKeys,
	children,
}: {
	id: string;
	title: string;
	action?: ReactNode;
	itemKeys?: string[];
	children: ReactNode;
} ) {
	const [ expanded, setExpanded ] = useStoredFlag( `studio-ui-sidebar-group-${ id }`, true );
	useOpenOnAddedItems( itemKeys, expanded, () => setExpanded( true ) );
	return (
		<div role="group" className={ styles.group } aria-label={ title }>
			<div className={ styles.groupHeader }>
				<button
					type="button"
					className={ styles.groupToggle }
					aria-expanded={ expanded }
					onClick={ () => setExpanded( ! expanded ) }
				>
					{ title }
					<ChevronRightIcon className={ styles.groupChevron } />
				</button>
				{ action }
			</div>
			{ expanded ? children : null }
		</div>
	);
}

function SiteStatusButton( {
	site,
	isStarting,
	isStopping,
	onStart,
}: {
	site: SiteDetails;
	isStarting: boolean;
	isStopping: boolean;
	onStart?: () => void;
} ) {
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const busy = useIsSiteBusy( site );
	const operation = useSiteOperation( site );
	const status = getSiteStatus( site, isStarting, isStopping, operation );
	// The recorded operation wins: it names work this window didn't start (an
	// agent restart, another Studio window) that local start/stop state can't see.
	const statusName = getSiteStatusName( {
		running: site.running,
		starting: isStarting,
		stopping: isStopping,
		operation,
	} );
	const label = sprintf( site.running ? __( 'Stop %s' ) : __( 'Start %s' ), site.name );
	const handleClick = ( event: MouseEvent< HTMLButtonElement > ) => {
		event.stopPropagation();
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
			onStart?.();
		}
	};

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="muted-ghost"
						size="icon-sm"
						className={ clsx( styles.rowAction, styles.siteStatus ) }
						aria-label={ busy ? statusName : label }
						aria-busy={ busy || undefined }
						disabled={ busy }
						focusableWhenDisabled
						data-state={ status }
						onClick={ handleClick }
					>
						{ busy ? (
							<Spinner aria-hidden="true" />
						) : site.running ? (
							<StopSiteIcon />
						) : (
							<StartSiteIcon />
						) }
					</Button>
				}
			/>
			<TooltipContent>
				{ busy ? statusName : site.running ? __( 'Stop' ) : __( 'Start' ) }
			</TooltipContent>
		</Tooltip>
	);
}

// Right-click quick actions for a sidebar site row. The row element itself is
// passed as `trigger` and rendered via the context-menu trigger's render prop,
// so no wrapper DOM is added around it (the sidebar's drag-reorder CSS and
// animation code rely on the row's DOM position).
function SiteRowMenu( {
	site,
	trigger,
	onSiteOpen,
}: {
	site: SiteDetails;
	trigger: ReactElement;
	onSiteOpen?: () => void;
} ) {
	const actions = useSiteActions( site, { onOpen: onSiteOpen } );
	const bulk = useIsBulkTarget( sitePinKey( site.id ) );
	const [ menuOpen, setMenuOpen ] = useState( false );

	const stopMenuEventPropagation = (
		event: MouseEvent< HTMLElement > | ReactPointerEvent< HTMLElement >
	) => {
		event.stopPropagation();
	};

	return (
		<>
			<Menu.ContextMenuRoot open={ menuOpen } onOpenChange={ setMenuOpen }>
				<Menu.ContextMenuTrigger render={ trigger } { ...actions.shortcuts } />
				{ bulk ? (
					<BulkMenu
						onClose={ () => setMenuOpen( false ) }
						onClick={ stopMenuEventPropagation }
						onPointerDown={ stopMenuEventPropagation }
					/>
				) : (
					<Menu.ContextPopup
						onClick={ stopMenuEventPropagation }
						onPointerDown={ stopMenuEventPropagation }
						{ ...actions.shortcuts }
					>
						<SiteActionsMenuItems actions={ actions } />
					</Menu.ContextPopup>
				) }
			</Menu.ContextMenuRoot>
			{ actions.dialogs }
		</>
	);
}

function SiteSection( {
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
	const navigate = useNavigate();
	const sectionRef = useRef< HTMLElement >( null );
	const [ chatCount, setChatCount ] = useState( CHATS_INITIAL_COUNT );
	const isActive = isChatActive || isContextActive;
	// Users who switched Studio Code off use the site's own page as its home.
	const isSelected = isChatActive || ( isContextActive && ! chatEnabled );
	const showContextOutline = isContextActive && chatEnabled;
	const showChats = expanded && chatEnabled && ( chats.length > 0 || loadError );
	const visibleChats = chats.slice( 0, chatCount );
	// Keep the active site visible — e.g. when launch restores a site that
	// sits below the sidebar's fold. `nearest` no-ops when already visible.
	useEffect( () => {
		if ( isActive ) {
			sectionRef.current?.scrollIntoView?.( { block: 'nearest' } );
		}
	}, [ isActive ] );
	useEffect( () => {
		if ( ! expanded ) {
			setChatCount( CHATS_INITIAL_COUNT );
		}
	}, [ expanded ] );
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const status = getSiteStatus( site, isStarting, isStopping, useSiteOperation( site ) );
	const agentActivity = useSiteAgentActivity( row.sessionIds );
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
	const displayActivity = siteActivity ? siteActivity : agentActivity;
	const openSite = useOpenSite();
	const handleOpenSite = () => {
		onOpen?.();
		onSiteOpen?.();
		openSite( site, resumeChat( site.id, row.chats ) );
	};
	const renderChat = ( session: AiSessionSummary ) => (
		<ChatRow
			key={ session.id }
			session={ session }
			active={ session.id === activeSessionId }
			nested
			onOpen={ onSiteOpen }
		/>
	);

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
								aria-expanded={ onOpen && chats.length > 0 ? showChats : undefined }
							>
								<span
									className={ clsx(
										styles.siteName,
										status === 'transitioning' && styles.siteNameStarting
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
			{ showChats ? (
				<div
					role="group"
					aria-label={ sprintf(
						/* translators: %s: site name. */
						__( '%s chats' ),
						site.name
					) }
					className={ styles.chats }
				>
					{ loadError ? <RetryLoadingChats /> : null }
					{ reorderable ? (
						<SidebarReorderableList
							items={ visibleChats }
							getItemId={ ( session ) => session.id }
							getItemLabel={ getSessionTitle }
							renderItem={ renderChat }
							onReorder={ ( ids ) => {
								const moved = [ ...ids ];
								const visible = new Set( ids );
								onReorderChats(
									chats.map( ( session ) =>
										visible.has( session.id ) ? moved.shift()! : session.id
									)
								);
							} }
						/>
					) : (
						visibleChats.map( renderChat )
					) }
					{ chats.length > chatCount ? (
						<SidebarButton
							className={ clsx( styles.chat, styles.mutedRow ) }
							onClick={ () => setChatCount( ( count ) => count + CHATS_PAGE_SIZE ) }
						>
							<span className={ styles.chatTitle }>{ __( 'Show more' ) }</span>
						</SidebarButton>
					) : null }
				</div>
			) : null }
		</section>
	);
}

type PinnedItem =
	| { key: string; row: SiteRow; session?: undefined }
	| { key: string; row?: undefined; session: AiSessionSummary };

function findSessionSiteKey(
	rows: SiteRow[],
	activeSessionId: string | undefined
): string | undefined {
	if ( ! activeSessionId ) {
		return undefined;
	}
	return rows.find( ( row ) => row.sessionIds.includes( activeSessionId ) )?.site.id;
}

export function SiteList( {
	className,
	onSiteOpen,
	reorderable = true,
	sections = false,
}: {
	className?: string;
	onSiteOpen?: () => void;
	/** The collapsed-sidebar switcher renders a read-only order. */
	reorderable?: boolean;
	/** The sidebar groups sites, with their chats, and recent chats. */
	sections?: boolean;
} ) {
	const openAddSite = useOpenAddSite();
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading, isError: sessionsError } = useSessions();
	const needingInput = useSessionsNeedingInput();
	const { chatEnabled } = useAgenticFeatures();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const activeSessionId = params.sessionId;
	const activeSiteId = params.siteId;
	const [ manualSiteOrder, setManualSiteOrder ] = useState< string[] >( [] );
	const updateSitesSortOrder = useUpdateSitesSortOrder();
	const { pins, chatOrder, showRecentChats, autoCollapseSites, save } = useSidebarPreferences();

	const orderedSites = useMemo(
		() => sortSitesByManualOrder( sortSites( [ ...( sites ?? [] ) ] ), manualSiteOrder ),
		[ sites, manualSiteOrder ]
	);
	const rows = useMemo(
		() => createSiteRows( orderedSites, sessions ),
		[ orderedSites, sessions ]
	);
	const activeChatSiteKey = useMemo( () => {
		const sessionSiteKey = findSessionSiteKey( rows, activeSessionId );
		if ( sessionSiteKey ) {
			return sessionSiteKey;
		}
		return activeSiteId && pathname === `/sites/${ activeSiteId }/new` ? activeSiteId : undefined;
	}, [ activeSessionId, activeSiteId, pathname, rows ] );
	// Site ids are UUIDs, so no URL decoding is needed to compare the path.
	const activeSettingsSiteKey =
		activeSiteId && pathname === `/sites/${ activeSiteId }/settings` ? activeSiteId : undefined;
	const activeContextSiteKey =
		activeSettingsSiteKey ??
		( activeSiteId && pathname === `/sites/${ activeSiteId }` ? activeSiteId : undefined );
	const activeSiteKey = activeChatSiteKey ?? activeContextSiteKey;
	const persistOrder = ( nextSiteIds: string[] ) => {
		setManualSiteOrder( nextSiteIds );
		updateSitesSortOrder.mutate( nextSiteIds );
	};

	// Sites whose chats show under their row. Opening a site unfolds it (and,
	// unless the user turned it off, folds the others); clicking the open site
	// again folds it.
	const [ revealed, setRevealed ] = useState< ReadonlySet< string > >(
		() => new Set( activeSiteKey ? [ activeSiteKey ] : [] )
	);
	const reveal = ( current: ReadonlySet< string >, siteId: string ) =>
		new Set( autoCollapseSites ? [ siteId ] : [ ...current, siteId ] );
	const revealActive = useEffectEvent( ( siteId: string ) =>
		setRevealed( ( current ) => ( current.has( siteId ) ? current : reveal( current, siteId ) ) )
	);
	useEffect( () => {
		if ( activeSiteKey ) {
			revealActive( activeSiteKey );
		}
	}, [ activeSiteKey ] );
	const collapseAll = useCallback( () => setRevealed( new Set() ), [] );
	const toggleSiteChats = ( siteId: string ) =>
		setRevealed( ( current ) =>
			siteId === activeSiteKey && current.has( siteId )
				? new Set( [ ...current ].filter( ( id ) => id !== siteId ) )
				: reveal( current, siteId )
		);

	// The sidebar moves pinned sites and chats out of their usual place into the Pinned group.
	const pinned = new Set( sections ? pins : [] );
	const isChatPinned = ( session: AiSessionSummary ) => pinned.has( chatPinKey( session.id ) );
	const rowsById = new Map( rows.map( ( row ) => [ row.site.id, row ] ) );
	const sessionsById = new Map( ( sessions ?? [] ).map( ( session ) => [ session.id, session ] ) );
	const pinnedItems = [ ...pinned ].flatMap< PinnedItem >( ( key ) => {
		const id = key.slice( key.indexOf( ':' ) + 1 );
		const row = key === sitePinKey( id ) ? rowsById.get( id ) : undefined;
		const session = key === chatPinKey( id ) ? sessionsById.get( id ) : undefined;
		if ( row ) {
			return [ { key, row } ];
		}
		// A pinned chat waiting on an answer shows under Needs input instead.
		return session && chatEnabled && ! session.archived && ! needingInput.includes( session.id )
			? [ { key, session } ]
			: [];
	} );
	const siteRows = rows.filter( ( row ) => ! pinned.has( sitePinKey( row.site.id ) ) );
	// A chat waiting on an answer shows once, under Needs input.
	const siteChats = ( row: SiteRow ) =>
		orderChats(
			row.chats.filter(
				( session ) => ! isChatPinned( session ) && ! needingInput.includes( session.id )
			),
			chatOrder[ row.site.id ]
		);
	const siteNameOf = ( session: AiSessionSummary ) =>
		rows.find( ( row ) => row.sessionIds.includes( session.id ) )?.site.name;

	const renderSiteRow = ( row: SiteRow ) => (
		<SiteSection
			row={ row }
			chats={ siteChats( row ) }
			isChatActive={ row.site.id === activeChatSiteKey }
			isContextActive={ row.site.id === activeContextSiteKey }
			chatEnabled={ chatEnabled }
			activeSessionId={ activeSessionId }
			expanded={ sections && revealed.has( row.site.id ) }
			loadError={ sessionsError }
			reorderable={ reorderable }
			onOpen={ sections ? () => toggleSiteChats( row.site.id ) : undefined }
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
	if ( sitesLoading || sessionsLoading ) {
		listContent = <p className={ styles.empty }>{ __( 'Loading…' ) }</p>;
	} else if ( rows.length === 0 ) {
		listContent = <p className={ styles.empty }>{ __( 'No sites yet' ) }</p>;
	} else if ( ! reorderable ) {
		listContent = (
			<div className={ styles.sites }>
				{ siteRows.map( ( row ) => (
					<Fragment key={ row.site.id }>{ renderSiteRow( row ) }</Fragment>
				) ) }
			</div>
		);
	} else {
		listContent = (
			<SidebarReorderableList
				items={ siteRows }
				getItemId={ ( row ) => row.site.id }
				getItemLabel={ ( row ) => row.site.name }
				renderItem={ renderSiteRow }
				onReorder={ persistOrder }
			/>
		);
	}

	const canCollapseAll =
		!! sections &&
		siteRows.filter( ( row ) => revealed.has( row.site.id ) && siteChats( row ).length > 0 )
			.length > 1;
	useProvideCollapseAll( canCollapseAll ? collapseAll : undefined );

	if ( ! sections ) {
		return <div className={ clsx( styles.root, className ) }>{ listContent }</div>;
	}

	const loaded = ! sitesLoading && ! sessionsLoading;
	const openChats = chatEnabled
		? ( sessions ?? [] ).filter( ( session ) => ! session.archived ).sort( byMostRecent )
		: [];
	// Chats waiting on an answer move to the top until it's given.
	const needsInputChats = openChats.filter( ( session ) => needingInput.includes( session.id ) );
	const recentChats = openChats
		.filter( ( session ) => ! needingInput.includes( session.id ) && ! isChatPinned( session ) )
		.slice( 0, RECENT_CHATS_LIMIT );
	const renderChat = ( session: AiSessionSummary, siteName?: string ) => (
		<ChatRow
			key={ session.id }
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
					<SidebarGroup
						id="needs-input"
						title={ __( 'Needs input' ) }
						itemKeys={ needsInputChats.map( ( session ) => session.id ) }
					>
						<div className={ styles.chats }>
							{ needsInputChats.map( ( session ) => renderChat( session ) ) }
						</div>
					</SidebarGroup>
				) : null }
				{ pinnedItems.length > 0 ? (
					<SidebarGroup
						id="pinned"
						title={ __( 'Pinned' ) }
						itemKeys={ loaded ? pinnedItems.map( ( item ) => item.key ) : undefined }
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
							renderItem={ ( item ) =>
								item.row
									? renderSiteRow( item.row )
									: renderChat( item.session, siteNameOf( item.session ) )
							}
							onReorder={ ( sidebarPins ) => save( { sidebarPins } ) }
						/>
					</SidebarGroup>
				) : null }
				<SidebarGroup
					id="sites"
					title={ __( 'Sites' ) }
					itemKeys={ loaded ? siteRows.map( ( row ) => row.site.id ) : undefined }
					action={
						<span className={ styles.groupActions }>
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
						</span>
					}
				>
					{ listContent }
				</SidebarGroup>
				{ showRecentChats && ( recentChats.length > 0 || sessionsError ) ? (
					<SidebarGroup
						id="recent"
						title={ __( 'Recent' ) }
						itemKeys={ loaded ? recentChats.map( ( session ) => session.id ) : undefined }
					>
						{ sessionsError ? (
							<div className={ styles.chats }>
								<RetryLoadingChats />
							</div>
						) : (
							<div className={ styles.chats }>
								{ recentChats.map( ( session ) => renderChat( session ) ) }
							</div>
						) }
					</SidebarGroup>
				) : null }
			</SidebarSelection>
		</div>
	);
}
