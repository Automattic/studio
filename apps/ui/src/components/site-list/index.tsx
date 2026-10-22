import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { sortSites } from '@studio/common/lib/sort-sites';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { clsx } from 'clsx';
import {
	Fragment,
	useEffect,
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
import { ReorderableList } from '@/components/reorderable-list';
import { getSessionTitle } from '@/components/session-view/session-chat-actions';
import { SidebarButton } from '@/components/sidebar-button';
import { SiteActionsMenuItems, useSiteActions } from '@/components/site-actions-menu';
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
import { chatPinKey, sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
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
import {
	archiveIcon,
	chatIcon,
	chevronRightIcon,
	globeIcon,
	newChatIcon,
	pinIcon,
	plusIcon,
	startSiteIcon,
	stopSiteIcon,
	unpinIcon,
} from '@/lib/icons';
import { BulkMenuItems, SidebarSelection, useIsBulkTarget, useSelectableRow } from './selection';
import { getSiteStatus, getSiteStatusName } from './site-status';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

type SiteRow = {
	site: SiteDetails;
	latestSession?: AiSessionSummary;
	sessionIds: string[];
	// Non-archived, most recent first.
	chats: AiSessionSummary[];
};

// Chats listed under the selected site, and in the Recent group.
const SITE_CHATS_LIMIT = 5;
const RECENT_CHATS_LIMIT = 8;

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
		latestSession: undefined,
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
		row.latestSession = row.chats[ 0 ];
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

function ChatRow( {
	session,
	active,
	nested = false,
	onOpen,
}: {
	session: AiSessionSummary;
	active: boolean;
	// Under its site the row indents to the site's name and drops its icon.
	nested?: boolean;
	onOpen?: () => void;
} ) {
	const navigate = useNavigate();
	const activity = useSiteAgentActivity( [ session.id ] );
	const actions = useChatActions( session, active );
	const selectable = useSelectableRow( chatPinKey( session.id ) );
	const bulk = useIsBulkTarget( chatPinKey( session.id ) );

	return (
		<>
			<Menu.ContextMenuRoot>
				<Menu.ContextMenuTrigger
					render={
						<div
							{ ...selectable }
							className={ clsx(
								styles.chatRow,
								nested && styles.chatNested,
								active && styles.chatActive
							) }
						>
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
								{ nested ? null : <Icon icon={ chatIcon } className={ styles.rowIcon } /> }
								<span className={ styles.chatTitle }>{ getSessionTitle( session ) }</span>
								{ actions.working ? (
									<AgentWorkingIndicator
										className={ styles.chatActivity }
										label={ __( 'Working…' ) }
									/>
								) : null }
								{ activity === 'pending-question' ? (
									<span
										className={ styles.chatQuestion }
										role="status"
										aria-label={ __( 'Studio needs an answer.' ) }
									/>
								) : null }
								{ session.unread && ! active ? (
									<span className={ styles.unreadDot } role="img" aria-label={ __( 'Unread' ) } />
								) : null }
							</SidebarButton>
							<span className={ styles.chatActions }>
								<IconButton
									variant="muted-ghost"
									size="icon-sm"
									icon={ actions.pinned ? unpinIcon : pinIcon }
									label={ actions.pinned ? __( 'Unpin chat' ) : __( 'Pin chat' ) }
									onClick={ actions.togglePin }
								/>
								<IconButton
									variant="muted-ghost"
									size="icon-sm"
									icon={ archiveIcon }
									label={ __( 'Archive chat' ) }
									disabled={ actions.working }
									onClick={ () => void actions.archive() }
								/>
							</span>
						</div>
					}
				/>
				<Menu.ContextPopup onKeyDown={ ( event ) => actions.handleShortcut( event.nativeEvent ) }>
					{ bulk ? <BulkMenuItems /> : <ChatActionsMenuItems actions={ actions } /> }
				</Menu.ContextPopup>
			</Menu.ContextMenuRoot>
			{ actions.renameDialog }
		</>
	);
}

function SidebarGroup( {
	title,
	action,
	children,
}: {
	title: string;
	action?: ReactNode;
	children: ReactNode;
} ) {
	const [ expanded, setExpanded ] = useState( true );
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
					<Icon icon={ chevronRightIcon } className={ styles.groupChevron } />
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
}: {
	site: SiteDetails;
	isStarting: boolean;
	isStopping: boolean;
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
						) : (
							<Icon icon={ site.running ? stopSiteIcon : startSiteIcon } />
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

	const stopMenuEventPropagation = (
		event: MouseEvent< HTMLElement > | ReactPointerEvent< HTMLElement >
	) => {
		event.stopPropagation();
	};

	return (
		<>
			<Menu.ContextMenuRoot>
				<Menu.ContextMenuTrigger render={ trigger } />
				<Menu.ContextPopup
					onClick={ stopMenuEventPropagation }
					onPointerDown={ stopMenuEventPropagation }
					onKeyDown={ ( event ) => bulk || actions.handleShortcut( event.nativeEvent ) }
				>
					{ bulk ? <BulkMenuItems /> : <SiteActionsMenuItems actions={ actions } /> }
				</Menu.ContextPopup>
			</Menu.ContextMenuRoot>
			{ actions.dialogs }
		</>
	);
}

function SiteSection( {
	row,
	isChatActive,
	isContextActive,
	chatEnabled,
	chatPromptsSignIn,
	activeSessionId,
	showChats,
	onSiteOpen,
}: {
	row: SiteRow;
	isChatActive: boolean;
	isContextActive: boolean;
	chatEnabled: boolean;
	chatPromptsSignIn: boolean;
	activeSessionId?: string;
	// Lists the site's chats under its row.
	showChats: boolean;
	onSiteOpen?: () => void;
} ) {
	const { site, latestSession } = row;
	const selectable = useSelectableRow( sitePinKey( site.id ) );
	const navigate = useNavigate();
	const sectionRef = useRef< HTMLElement >( null );
	const isActive = isChatActive || isContextActive;
	const canOpenChatSurface = chatEnabled || chatPromptsSignIn;
	// Offline users and users who switched Studio Code off use the site's own
	// page as its home. Signed-out users still get the chat surface, where the value
	// of logging in can be explained in context.
	const isSelected = isChatActive || ( isContextActive && ! canOpenChatSurface );
	const showContextOutline = isContextActive && canOpenChatSurface;
	const chats = showChats && chatEnabled ? row.chats.slice( 0, SITE_CHATS_LIMIT ) : [];
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
		onSiteOpen?.();
		openSite( site, latestSession );
	};

	return (
		<section
			ref={ sectionRef }
			className={ clsx(
				styles.site,
				isSelected && styles.siteActive,
				showContextOutline && styles.siteContextActive,
				chats.length > 0 && styles.siteWithChats
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
							{ site.enableXdebug ? (
								<XdebugIcon className={ styles.siteXdebug } />
							) : (
								<Icon icon={ globeIcon } />
							) }
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
									icon={ newChatIcon }
									label={ sprintf( __( 'New chat for %s' ), site.name ) }
									className={ styles.rowAction }
									onClick={ ( event ) => {
										event.stopPropagation();
										onSiteOpen?.();
										void navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
									} }
								/>
							) : null }
							<SiteStatusButton site={ site } isStarting={ isStarting } isStopping={ isStopping } />
						</div>
					</header>
				}
			/>
			{ chats.length > 0 ? (
				<div className={ styles.chats }>
					{ chats.map( ( session ) => (
						<ChatRow
							key={ session.id }
							session={ session }
							active={ session.id === activeSessionId }
							nested
							onOpen={ onSiteOpen }
						/>
					) ) }
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
	/** The sidebar groups sites, with the selected site's chats, and recent chats. */
	sections?: boolean;
} ) {
	const openAddSite = useOpenAddSite();
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();
	const needingInput = useSessionsNeedingInput();
	const { chatEnabled, chatPromptsSignIn } = useAgenticFeatures();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const activeSessionId = params.sessionId;
	const activeSiteId = params.siteId;
	const [ manualSiteOrder, setManualSiteOrder ] = useState< string[] >( [] );
	const updateSitesSortOrder = useUpdateSitesSortOrder();
	const { pins, setPins } = useSidebarPins();

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
	const persistOrder = ( nextSiteIds: string[] ) => {
		setManualSiteOrder( nextSiteIds );
		updateSitesSortOrder.mutate( nextSiteIds );
	};

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

	const renderSiteRow = ( row: SiteRow ) => (
		<SiteSection
			row={ { ...row, chats: row.chats.filter( ( session ) => ! isChatPinned( session ) ) } }
			isChatActive={ row.site.id === activeChatSiteKey }
			isContextActive={ row.site.id === activeContextSiteKey }
			chatEnabled={ chatEnabled }
			chatPromptsSignIn={ chatPromptsSignIn }
			activeSessionId={ activeSessionId }
			showChats={
				sections && ( row.site.id === activeChatSiteKey || row.site.id === activeContextSiteKey )
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
			<ReorderableList
				items={ siteRows }
				getItemId={ ( row ) => row.site.id }
				renderItem={ renderSiteRow }
				onReorder={ persistOrder }
				className={ styles.sites }
				itemClassName={ styles.siteDragWrapper }
				placeholderClassName={ styles.siteDropPlaceholder }
				previewClassName={ styles.siteDragPreview }
				excludeSelector="[data-reorder-exclude]"
			/>
		);
	}

	if ( ! sections ) {
		return <div className={ clsx( styles.root, className ) }>{ listContent }</div>;
	}

	const openChats = chatEnabled
		? ( sessions ?? [] ).filter( ( session ) => ! session.archived ).sort( byMostRecent )
		: [];
	// Chats waiting on an answer move to the top until it's given.
	const needsInputChats = openChats.filter( ( session ) => needingInput.includes( session.id ) );
	const recentChats = openChats
		.filter( ( session ) => ! needingInput.includes( session.id ) && ! isChatPinned( session ) )
		.slice( 0, RECENT_CHATS_LIMIT );
	const renderChats = ( chats: AiSessionSummary[] ) => (
		<div className={ styles.chats }>
			{ chats.map( ( session ) => (
				<ChatRow
					key={ session.id }
					session={ session }
					active={ session.id === activeSessionId }
					onOpen={ onSiteOpen }
				/>
			) ) }
		</div>
	);

	return (
		<div className={ clsx( styles.root, className ) }>
			<SidebarSelection>
				{ needsInputChats.length > 0 ? (
					<SidebarGroup title={ __( 'Needs input' ) }>
						{ renderChats( needsInputChats ) }
					</SidebarGroup>
				) : null }
				{ pinnedItems.length > 0 ? (
					<SidebarGroup
						title={ __( 'Pinned' ) }
						action={
							<IconButton
								variant="muted-ghost"
								size="icon-sm"
								icon={ plusIcon }
								label={ __( 'Add pinned site' ) }
								onClick={ () => openAddSite( 'create', { pin: true } ) }
							/>
						}
					>
						<ReorderableList
							items={ pinnedItems }
							getItemId={ ( item ) => item.key }
							renderItem={ ( item ) =>
								item.row ? (
									renderSiteRow( item.row )
								) : (
									<ChatRow
										session={ item.session }
										active={ item.session.id === activeSessionId }
										onOpen={ onSiteOpen }
									/>
								)
							}
							onReorder={ setPins }
							className={ styles.sites }
							itemClassName={ styles.siteDragWrapper }
							placeholderClassName={ styles.siteDropPlaceholder }
							previewClassName={ styles.siteDragPreview }
							excludeSelector="[data-reorder-exclude]"
						/>
					</SidebarGroup>
				) : null }
				<SidebarGroup
					title={ __( 'Sites' ) }
					action={
						<IconButton
							variant="muted-ghost"
							size="icon-sm"
							icon={ plusIcon }
							label={ __( 'Add site' ) }
							onClick={ () => openAddSite() }
						/>
					}
				>
					{ listContent }
				</SidebarGroup>
				{ recentChats.length > 0 ? (
					<SidebarGroup title={ __( 'Recent' ) }>{ renderChats( recentChats ) }</SidebarGroup>
				) : null }
			</SidebarSelection>
		</div>
	);
}
