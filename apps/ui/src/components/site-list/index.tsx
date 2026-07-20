import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { sortSites } from '@studio/common/lib/sort-sites';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import {
	category,
	chevronDown,
	chevronRight,
	closeSmall,
	funnel,
	plugins as pluginsIcon,
	settings,
	wordpress,
} from '@wordpress/icons';
import { Button, Icon, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import { useTourAnchor } from '@/components/coachmarks/anchor-registry';
import * as Menu from '@/components/menu';
import { ReorderableList } from '@/components/reorderable-list';
import { SegmentedControl } from '@/components/segmented-control';
import { SidebarButton } from '@/components/sidebar-button';
import { SiteContextMenu } from '@/components/site-context-menu';
import { deriveSiteStatus } from '@/components/site-dropdown/utils';
import { useSiteActivityOverride } from '@/data/dev-lab-site-activity';
import { useSiteAgentActivity, type SiteAgentActivity } from '@/data/queries/use-agent-run';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
	useUpdateSitesSortOrder,
} from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { usePluginSiteTags } from '@/lib/plugin-prototype';
import {
	createSiteGroup,
	removeSiteGroup,
	toggleSiteGroupCollapsed,
	useSiteGroups,
} from '@/lib/site-groups-prototype';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

type SiteRow = {
	site: SiteDetails;
	latestSession?: AiSessionSummary;
	sessionIds: string[];
};

type SiteRowActivity = SiteAgentActivity | 'new-message' | 'sync';

const ACTIVITY_EXIT_DURATION_MS = 180;
const SIDEBAR_VIEW_STORAGE_KEY = 'studio-ui-sidebar-view-v1';
const SIDEBAR_SORT_STORAGE_KEY = 'studio-ui-sidebar-sort-v1';

type SidebarView = 'all' | 'sites' | 'plugins';

const SIDEBAR_VIEWS: SidebarView[] = [ 'all', 'sites', 'plugins' ];

// 'custom' is the hand-arranged order (drag to reorder); every other mode
// derives the order, so dragging is unavailable while one is active.
type SidebarSort =
	| 'custom'
	| 'name-asc'
	| 'name-desc'
	| 'running-first'
	| 'created-desc'
	| 'created-asc';

const SIDEBAR_SORTS: SidebarSort[] = [
	'custom',
	'name-asc',
	'name-desc',
	'running-first',
	'created-desc',
	'created-asc',
];

function readStoredSidebarSort(): SidebarSort {
	try {
		const stored = window.localStorage.getItem( SIDEBAR_SORT_STORAGE_KEY );
		return SIDEBAR_SORTS.includes( stored as SidebarSort ) ? ( stored as SidebarSort ) : 'custom';
	} catch {
		return 'custom';
	}
}

function writeStoredSidebarSort( sort: SidebarSort ): void {
	try {
		window.localStorage.setItem( SIDEBAR_SORT_STORAGE_KEY, sort );
	} catch {
		// Ignore storage failures; the selection still applies for this render.
	}
}

// Creation dates aren't part of SiteDetails; the config order stands in for
// them (sites are appended to cli.json as they're created), passed here as a
// site-id → index rank.
function compareRows(
	a: SiteRow,
	b: SiteRow,
	sort: SidebarSort,
	creationRank: Map< string, number >
): number {
	switch ( sort ) {
		case 'name-asc':
			return a.site.name.localeCompare( b.site.name );
		case 'name-desc':
			return b.site.name.localeCompare( a.site.name );
		case 'running-first':
			return (
				Number( b.site.running ) - Number( a.site.running ) ||
				a.site.name.localeCompare( b.site.name )
			);
		case 'created-desc':
			return ( creationRank.get( b.site.id ) ?? 0 ) - ( creationRank.get( a.site.id ) ?? 0 );
		case 'created-asc':
			return ( creationRank.get( a.site.id ) ?? 0 ) - ( creationRank.get( b.site.id ) ?? 0 );
		default:
			return 0;
	}
}

function readStoredSidebarView(): SidebarView {
	try {
		const stored = window.localStorage.getItem( SIDEBAR_VIEW_STORAGE_KEY );
		return SIDEBAR_VIEWS.includes( stored as SidebarView ) ? ( stored as SidebarView ) : 'all';
	} catch {
		return 'all';
	}
}

function writeStoredSidebarView( view: SidebarView ): void {
	try {
		window.localStorage.setItem( SIDEBAR_VIEW_STORAGE_KEY, view );
	} catch {
		// Ignore storage failures; the selection still applies for this render.
	}
}

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
		<Tooltip.Root>
			<Tooltip.Trigger
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
			</Tooltip.Trigger>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
		</Tooltip.Root>
	);
}

function SiteAgentActivityIndicator( {
	activity,
	idleGlyph,
}: {
	activity: SiteRowActivity;
	// Occupies the slot while there's no activity (the mixed "All" view's
	// type glyph); an active indicator crossfades in over it. Keeps the slot
	// permanently expanded so row labels never shift.
	idleGlyph?: ReactNode;
} ) {
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
	const newMessageLabel = __( 'New message' );
	const syncLabel = __( 'Syncing live site' );

	return (
		<span
			className={ clsx(
				styles.siteAgentActivitySlot,
				( isVisible || idleGlyph ) && styles.siteAgentActivitySlotVisible
			) }
			aria-hidden={ isVisible ? undefined : 'true' }
		>
			{ idleGlyph ? (
				<span
					className={ clsx( styles.siteTypeGlyph, isVisible && styles.siteTypeGlyphHidden ) }
					aria-hidden="true"
				>
					{ idleGlyph }
				</span>
			) : null }
			<span
				className={ clsx(
					styles.siteActivityStack,
					! isVisible && styles.siteActivityStackHidden
				) }
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
				{ renderedActivity === 'new-message' ? (
					<SiteAgentActivityTooltip
						label={ newMessageLabel }
						className={ styles.siteAgentActivityMessage }
					/>
				) : null }
				{ renderedActivity === 'sync' ? (
					<SiteAgentActivityTooltip label={ syncLabel } className={ styles.siteAgentActivitySync }>
						<span className={ styles.siteAgentActivitySyncDots } aria-hidden="true">
							<span className={ styles.siteAgentActivitySyncDot } />
							<span className={ styles.siteAgentActivitySyncDot } />
							<span className={ styles.siteAgentActivitySyncDot } />
						</span>
					</SiteAgentActivityTooltip>
				) : null }
			</span>
		</span>
	);
}

function getTimestamp( session: AiSessionSummary | undefined ): number {
	return session ? Date.parse( session.updatedAt ) || 0 : 0;
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

function createSiteRows(
	sites: SiteDetails[] | undefined,
	sessions: AiSessionSummary[] | undefined
): SiteRow[] {
	const rows: SiteRow[] = ( sites ?? [] ).map( ( site ) => ( {
		site,
		sessionIds: [],
		latestSession: undefined,
	} ) );
	const rowsBySiteId = new Map( rows.map( ( row ) => [ row.site.id, row ] ) );

	for ( const session of sessions ?? [] ) {
		const ownerSite = findAiSessionOwnerSite( sites, session );
		const row = ownerSite ? rowsBySiteId.get( ownerSite.id ) : undefined;
		if ( ! row ) {
			continue;
		}
		row.sessionIds.push( session.id );
		if (
			! session.archived &&
			( ! row.latestSession || getTimestamp( session ) > getTimestamp( row.latestSession ) )
		) {
			row.latestSession = session;
		}
	}

	return rows;
}

function SiteOverviewButton( {
	site,
	isActive = false,
	isPlugin = false,
	isOverviewAnchor = false,
}: {
	site: SiteDetails;
	isActive?: boolean;
	isPlugin?: boolean;
	// Registers this gear as the coachmark target for "view site overview".
	// Exactly one row's gear is the anchor at a time.
	isOverviewAnchor?: boolean;
} ) {
	const navigate = useNavigate();
	const overviewAnchorRef = useTourAnchor( 'sidebar-site-row-overview', {
		disabled: ! isOverviewAnchor,
	} );

	return (
		<IconButton
			ref={ overviewAnchorRef }
			variant="minimal"
			tone="neutral"
			size="small"
			icon={ settings }
			label={ isPlugin ? __( 'Plugin overview' ) : __( 'Site overview' ) }
			className={ clsx( styles.siteAction, isActive && styles.siteActionActive ) }
			aria-current={ isActive ? 'page' : undefined }
			onClick={ ( event ) => {
				event.stopPropagation();
				void navigate( {
					to: '/sites/$siteId/overview',
					params: { siteId: site.id },
				} );
			} }
		/>
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
	const { status } = deriveSiteStatus( site, isStarting, isStopping );
	const busy = isStarting || isStopping;
	const statusName =
		status === 'running'
			? __( 'Running' )
			: status === 'transitioning'
			? isStopping
				? __( 'Stopping' )
				: __( 'Starting' )
			: __( 'Stopped' );
	const tooltipLabel = sprintf( __( 'Site status: %s' ), statusName );
	const actionLabel = site.running ? __( 'Stop site' ) : __( 'Start site' );
	const label = busy ? tooltipLabel : sprintf( __( '%1$s. %2$s' ), tooltipLabel, actionLabel );
	const handleClick = ( event: MouseEvent< HTMLButtonElement > ) => {
		event.stopPropagation();
		if ( busy ) {
			return;
		}
		if ( site.running ) {
			stopSite.mutate( site.id );
		} else {
			startSite.mutate( site.id );
		}
	};

	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ styles.siteStatus }
						aria-label={ label }
						aria-busy={ busy || undefined }
						aria-disabled={ busy || undefined }
						data-state={ status }
						onClick={ handleClick }
					>
						<svg
							className={ styles.siteStatusGlyph }
							viewBox={ status === 'stopped' ? '0 0 10 10' : '0 0 8 8' }
							aria-hidden="true"
							focusable="false"
						>
							{ status === 'stopped' ? (
								<path className={ styles.siteStatusPlayShape } d="M2.5 1 L9 5 L2.5 9 Z" />
							) : (
								<rect className={ styles.siteStatusShape } x="0" y="0" width="8" height="8" />
							) }
						</svg>
						{ ! busy ? (
							site.running ? (
								<span className={ styles.siteStatusActionGlyph } aria-hidden="true">
									<span className={ styles.siteStatusPauseMark } />
								</span>
							) : (
								<svg
									className={ styles.siteStatusActionGlyph }
									viewBox="0 0 10 10"
									aria-hidden="true"
									focusable="false"
								>
									<path d="M2.5 1 L9 5 L2.5 9 Z" fill="currentColor" />
								</svg>
							)
						) : null }
					</button>
				}
			/>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ tooltipLabel }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}

function SiteSection( {
	row,
	isChatActive,
	isContextActive,
	hasUnreadUpdate = false,
	isPlugin = false,
	showTypeIcon = false,
	agenticGated = false,
	isOverviewAnchor = false,
	selecting = false,
	selected = false,
	onToggleSelect,
}: {
	row: SiteRow;
	isChatActive: boolean;
	isContextActive: boolean;
	hasUnreadUpdate?: boolean;
	// Prototype: true when this site is tagged as a plugin — only changes
	// the overview action's label; plugin rows otherwise look like sites.
	isPlugin?: boolean;
	// In the mixed "All" view a small leading glyph tells the types apart.
	showTypeIcon?: boolean;
	// When agentic features are unavailable the row opens the overview
	// directly, making the dedicated overview button redundant.
	agenticGated?: boolean;
	// Marks this row's gear as the "view site overview" coachmark target.
	isOverviewAnchor?: boolean;
	// Prototype grouping: while selecting (or on shift+click) row clicks
	// toggle membership in the pending selection instead of navigating.
	selecting?: boolean;
	selected?: boolean;
	onToggleSelect?: () => void;
} ) {
	const { site, latestSession } = row;
	const navigate = useNavigate();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const { status } = deriveSiteStatus( site, isStarting, isStopping );
	const agentActivity = useSiteAgentActivity( row.sessionIds );
	const syncActivity = useSiteSyncActivity( site.id );
	const isLiveSyncPending =
		syncActivity?.kind === 'pending' &&
		( syncActivity.direction === 'push' || syncActivity.direction === 'pull' );
	const computedActivity: SiteRowActivity = isLiveSyncPending
		? 'sync'
		: agentActivity !== 'idle'
		? agentActivity
		: hasUnreadUpdate
		? 'new-message'
		: 'idle';
	// Dev-only message lab override (see components/dev-message-lab).
	const forcedActivity = useSiteActivityOverride( site.id );
	const displayActivity = forcedActivity === 'auto' ? computedActivity : forcedActivity;
	const handleOpenSite = ( event: MouseEvent< HTMLElement > ) => {
		if ( onToggleSelect && ( selecting || event.shiftKey ) ) {
			onToggleSelect();
			return;
		}
		if ( agenticGated ) {
			void navigate( {
				to: '/sites/$siteId/overview',
				params: { siteId: site.id },
			} );
			return;
		}
		if ( latestSession ) {
			void navigate( {
				to: '/sessions/$sessionId',
				params: { sessionId: latestSession.id },
			} );
			return;
		}
		void navigate( {
			to: '/sites/$siteId/new',
			params: { siteId: site.id },
		} );
	};

	// When gated, the overview is the row's primary destination, so a
	// context-active row gets the normal selected treatment instead of the
	// dashed secondary one.
	const isPrimaryActive = isChatActive || ( agenticGated && isContextActive );

	// The row section doubles as the context-menu trigger (via render prop)
	// so no wrapper DOM disturbs the drag-reorder CSS and animation code.
	return (
		<SiteContextMenu
			site={ site }
			trigger={
				<section
					className={ clsx(
						styles.site,
						isPrimaryActive && styles.siteActive,
						! agenticGated && isContextActive && styles.siteContextActive,
						selected && styles.siteSelected
					) }
				>
					<header className={ styles.siteHeader } onClick={ handleOpenSite }>
						<div className={ styles.siteText }>
							<SiteAgentActivityIndicator
								activity={ displayActivity }
								idleGlyph={
									showTypeIcon ? (
										<Icon icon={ isPlugin ? pluginsIcon : wordpress } size={ 14 } />
									) : undefined
								}
							/>
							<SidebarButton
								className={ styles.siteToggle }
								onClick={ ( event ) => {
									event.stopPropagation();
									handleOpenSite( event );
								} }
								aria-current={ isPrimaryActive ? 'page' : undefined }
							>
								<span
									className={ clsx(
										styles.siteName,
										status === 'stopped' && styles.siteNameStopped,
										isStarting && styles.siteNameStarting
									) }
								>
									{ site.name }
								</span>
							</SidebarButton>
						</div>
						<div className={ styles.siteActions } data-site-actions>
							{ ! agenticGated && (
								<SiteOverviewButton
									site={ site }
									isActive={ isContextActive }
									isPlugin={ isPlugin }
									isOverviewAnchor={ isOverviewAnchor }
								/>
							) }
							<SiteStatusButton site={ site } isStarting={ isStarting } isStopping={ isStopping } />
						</div>
					</header>
				</section>
			}
		/>
	);
}

// Prototype: accordion heading for a named site group. Right-click offers
// ungrouping (when the section is a real group) so experiments are easy to
// undo.
function GroupHeading( {
	label,
	isOpen,
	onToggle,
	onUngroup,
}: {
	label: string;
	isOpen: boolean;
	onToggle: () => void;
	onUngroup?: () => void;
} ) {
	const heading = (
		<button
			type="button"
			className={ styles.groupHeading }
			aria-expanded={ isOpen }
			onClick={ onToggle }
		>
			<span className={ styles.groupHeadingLabel }>{ label }</span>
			<Icon icon={ isOpen ? chevronDown : chevronRight } size={ 16 } />
		</button>
	);

	if ( ! onUngroup ) {
		return heading;
	}

	return (
		<Menu.ContextMenuRoot>
			<Menu.ContextMenuTrigger render={ heading } />
			<Menu.ContextPopup>
				<Menu.Item onClick={ onUngroup }>{ __( 'Ungroup' ) }</Menu.Item>
			</Menu.ContextPopup>
		</Menu.ContextMenuRoot>
	);
}

function getRowSiteId( row: SiteRow ) {
	return row.site.id;
}

function findActiveSiteKey(
	rows: SiteRow[],
	activeSessionId: string | undefined,
	activeSiteId: string | undefined
): string | undefined {
	if ( activeSiteId ) {
		const match = rows.find( ( row ) => row.site.id === activeSiteId );
		if ( match ) return match.site.id;
	}
	return findSessionSiteKey( rows, activeSessionId );
}

function findSessionSiteKey(
	rows: SiteRow[],
	activeSessionId: string | undefined
): string | undefined {
	if ( ! activeSessionId ) {
		return undefined;
	}
	for ( const row of rows ) {
		if ( row.sessionIds.includes( activeSessionId ) ) {
			return row.site.id;
		}
	}
	return undefined;
}

function isSiteContextPath( pathname: string, siteId: string | undefined ) {
	if ( ! siteId ) {
		return false;
	}

	const [ root, routeSiteId, section, ...rest ] = pathname.split( '/' ).filter( Boolean );
	if ( rest.length > 0 || root !== 'sites' || ! routeSiteId ) {
		return false;
	}

	try {
		return (
			decodeURIComponent( routeSiteId ) === siteId &&
			( section === 'overview' || section === 'settings' )
		);
	} catch {
		return false;
	}
}

export function SiteList() {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const activeSessionId = params.sessionId;
	const activeSiteId = params.siteId;
	const [ manualSiteOrder, setManualSiteOrder ] = useState< string[] >( [] );
	const updateSitesSortOrder = useUpdateSitesSortOrder();
	// One subscription for the whole list; rows receive the resolved flag.
	const agenticFeatures = useAgenticFeatures();
	const agenticGated = agenticFeatures.isReady && ! agenticFeatures.enabled;
	// Prototype: plugin-tagged sites (see plugin-prototype.ts). Plugins are
	// just sites; tags only change where and how their rows render.
	const pluginTags = usePluginSiteTags();
	// Prototype: the sidebar shows one project type at a time, picked by the
	// segmented control at the top. View and sort survive reloads; the search
	// query is ephemeral.
	const [ view, setView ] = useState< SidebarView >( readStoredSidebarView );
	const selectView = ( nextView: SidebarView ) => {
		setView( nextView );
		writeStoredSidebarView( nextView );
	};
	const [ sort, setSort ] = useState< SidebarSort >( readStoredSidebarSort );
	const selectSort = ( nextSort: SidebarSort ) => {
		setSort( nextSort );
		writeStoredSidebarSort( nextSort );
	};
	const [ searchQuery, setSearchQuery ] = useState( '' );
	// Prototype grouping: selection is active while explicit select mode is on
	// (funnel menu) or any row is selected (shift+click starts one); a named
	// group is then cut from the selection.
	const siteGroups = useSiteGroups();
	const [ selectModeOn, setSelectModeOn ] = useState( false );
	const [ selectedSiteIds, setSelectedSiteIds ] = useState< Set< string > >( () => new Set() );
	const [ groupNaming, setGroupNaming ] = useState( false );
	const [ groupName, setGroupName ] = useState( '' );
	const [ otherGroupCollapsed, setOtherGroupCollapsed ] = useState( false );
	const selecting = selectModeOn || selectedSiteIds.size > 0;
	const toggleSelected = ( siteId: string ) => {
		setSelectedSiteIds( ( current ) => {
			const next = new Set( current );
			if ( next.has( siteId ) ) {
				next.delete( siteId );
			} else {
				next.add( siteId );
			}
			return next;
		} );
	};
	const clearSelection = () => {
		setSelectModeOn( false );
		setSelectedSiteIds( new Set() );
		setGroupNaming( false );
		setGroupName( '' );
	};
	const [ seenSiteSessionTimestampsInitialized, setSeenSiteSessionTimestampsInitialized ] =
		useState( false );
	const [ seenSiteSessionTimestamps, setSeenSiteSessionTimestamps ] = useState<
		Record< string, number >
	>( {} );

	const orderedSites = useMemo(
		() => sortSitesByManualOrder( sortSites( [ ...( sites ?? [] ) ] ), manualSiteOrder ),
		[ sites, manualSiteOrder ]
	);
	// Config order before any manual rearranging — the creation-date proxy for
	// the "Newest/Oldest first" sorts (see compareRows).
	const creationRank = useMemo(
		() => new Map( ( sites ?? [] ).map( ( site, index ) => [ site.id, index ] ) ),
		[ sites ]
	);
	const rows = useMemo(
		() => createSiteRows( orderedSites, sessions ),
		[ orderedSites, sessions ]
	);
	// Prototype: split plugin-tagged sites out of the (draggable) site list;
	// they render as ordinary site rows in their own spot.
	const pluginSiteIds = useMemo(
		() => new Set( pluginTags.map( ( tag ) => tag.siteId ) ),
		[ pluginTags ]
	);
	const siteRows = useMemo(
		() => rows.filter( ( row ) => ! pluginSiteIds.has( row.site.id ) ),
		[ rows, pluginSiteIds ]
	);
	const pluginSiteRows = useMemo(
		() => rows.filter( ( row ) => pluginSiteIds.has( row.site.id ) ),
		[ rows, pluginSiteIds ]
	);
	// Prototype grouping: resolve stored groups against the current site rows.
	// Members keep their stored order; groups whose sites all vanished drop
	// out of the render (the store keeps them in case the sites come back).
	const groupSections = useMemo( () => {
		const rowsBySiteId = new Map( siteRows.map( ( row ) => [ row.site.id, row ] ) );
		return siteGroups
			.map( ( group ) => ( {
				group,
				groupRows: group.siteIds
					.map( ( siteId ) => rowsBySiteId.get( siteId ) )
					.filter( ( row ): row is SiteRow => Boolean( row ) ),
			} ) )
			.filter( ( section ) => section.groupRows.length > 0 );
	}, [ siteGroups, siteRows ] );
	const ungroupedRows = useMemo( () => {
		const groupedIds = new Set( groupSections.flatMap( ( section ) => section.group.siteIds ) );
		return siteRows.filter( ( row ) => ! groupedIds.has( row.site.id ) );
	}, [ groupSections, siteRows ] );
	const submitGroup = () => {
		const name = groupName.trim();
		if ( ! name || selectedSiteIds.size === 0 ) {
			return;
		}
		// Members are stored in their current list order, not click order.
		createSiteGroup(
			name,
			siteRows.map( getRowSiteId ).filter( ( siteId ) => selectedSiteIds.has( siteId ) )
		);
		clearSelection();
	};
	const activeSiteKey = useMemo(
		() => findActiveSiteKey( rows, activeSessionId, activeSiteId ),
		[ rows, activeSessionId, activeSiteId ]
	);
	const activeChatSiteKey = useMemo(
		() => findSessionSiteKey( rows, activeSessionId ),
		[ rows, activeSessionId ]
	);
	const activeContextSiteKey = isSiteContextPath( pathname, activeSiteId )
		? activeSiteKey
		: undefined;
	useEffect( () => {
		if ( sitesLoading || sessionsLoading || rows.length === 0 ) {
			return;
		}
		const shouldSeedSeenTimestamps = ! seenSiteSessionTimestampsInitialized;
		setSeenSiteSessionTimestamps( ( current ) => {
			let next = current;
			let changed = false;

			const updateSeenTimestamp = ( siteId: string, timestamp: number ) => {
				if ( timestamp <= ( next[ siteId ] ?? 0 ) ) {
					return;
				}
				if ( next === current ) {
					next = { ...current };
				}
				next[ siteId ] = timestamp;
				changed = true;
			};

			for ( const row of rows ) {
				const latestTimestamp = getTimestamp( row.latestSession );
				if ( ! latestTimestamp ) {
					continue;
				}
				if ( shouldSeedSeenTimestamps || row.site.id === activeSiteKey ) {
					updateSeenTimestamp( row.site.id, latestTimestamp );
				}
			}

			return changed ? next : current;
		} );
		if ( ! seenSiteSessionTimestampsInitialized ) {
			setSeenSiteSessionTimestampsInitialized( true );
		}
	}, [ activeSiteKey, rows, seenSiteSessionTimestampsInitialized, sessionsLoading, sitesLoading ] );
	const unreadSiteIds = useMemo( () => {
		if ( ! seenSiteSessionTimestampsInitialized ) {
			return new Set< string >();
		}
		const unread = new Set< string >();
		for ( const row of rows ) {
			if ( row.site.id === activeSiteKey ) {
				continue;
			}
			const latestTimestamp = getTimestamp( row.latestSession );
			if ( latestTimestamp > ( seenSiteSessionTimestamps[ row.site.id ] ?? 0 ) ) {
				unread.add( row.site.id );
			}
		}
		return unread;
	}, [ activeSiteKey, rows, seenSiteSessionTimestamps, seenSiteSessionTimestampsInitialized ] );
	const rowSiteIds = useMemo( () => siteRows.map( getRowSiteId ), [ siteRows ] );
	const pluginRowIds = useMemo( () => pluginSiteRows.map( getRowSiteId ), [ pluginSiteRows ] );

	// Exactly one site row's gear is the "view site overview" coachmark anchor:
	// the active site's, falling back to the first site row.
	const overviewAnchorSiteId = useMemo( () => {
		if ( activeSiteKey && siteRows.some( ( row ) => row.site.id === activeSiteKey ) ) {
			return activeSiteKey;
		}
		return siteRows[ 0 ]?.site.id;
	}, [ activeSiteKey, siteRows ] );

	const listAnchorRef = useTourAnchor( 'sidebar-site-list' );

	// Both groups persist into the single stored order (ordering is applied to
	// the full site list before the rows split into groups), so a drop in one
	// group merges its new order with the other group's current order.
	const persistOrder = ( nextSiteIds: string[] ) => {
		setManualSiteOrder( nextSiteIds );
		updateSitesSortOrder.mutate( nextSiteIds );
	};

	const renderSiteRow = ( row: SiteRow ) => {
		const isPlugin = pluginSiteIds.has( row.site.id );
		return (
			<SiteSection
				row={ row }
				isPlugin={ isPlugin }
				showTypeIcon={ view === 'all' }
				isChatActive={ row.site.id === activeChatSiteKey }
				isContextActive={ row.site.id === activeContextSiteKey }
				hasUnreadUpdate={ unreadSiteIds.has( row.site.id ) }
				agenticGated={ agenticGated }
				isOverviewAnchor={ ! isPlugin && row.site.id === overviewAnchorSiteId }
				selecting={ ! isPlugin && selecting }
				selected={ ! isPlugin && selectedSiteIds.has( row.site.id ) }
				onToggleSelect={ isPlugin ? undefined : () => toggleSelected( row.site.id ) }
			/>
		);
	};

	const renderStaticRows = ( rowsToRender: SiteRow[] ) => (
		<div className={ styles.sites }>
			{ rowsToRender.map( ( row ) => (
				<div key={ row.site.id } className={ styles.siteDragWrapper } data-site-id={ row.site.id }>
					{ renderSiteRow( row ) }
				</div>
			) ) }
		</div>
	);

	const siteRowsBlock = (
		<ReorderableList
			items={ siteRows }
			getItemId={ getRowSiteId }
			renderItem={ renderSiteRow }
			onReorder={ ( nextIds ) => persistOrder( [ ...nextIds, ...pluginRowIds ] ) }
			className={ styles.sites }
			itemClassName={ styles.siteDragWrapper }
			placeholderClassName={ styles.siteDropPlaceholder }
			previewClassName={ styles.siteDragPreview }
			placeholderTestId="site-drop-placeholder"
			itemIdAttribute="data-site-id"
			excludeSelector="[data-site-actions]"
		/>
	);

	// Prototype: plugin-tagged sites render as ordinary site rows (status,
	// chat, overview all intact), draggable within their own view.
	const pluginRowsBlock = (
		<ReorderableList
			items={ pluginSiteRows }
			getItemId={ getRowSiteId }
			renderItem={ renderSiteRow }
			onReorder={ ( nextIds ) => persistOrder( [ ...rowSiteIds, ...nextIds ] ) }
			className={ styles.sites }
			itemClassName={ styles.siteDragWrapper }
			placeholderClassName={ styles.siteDropPlaceholder }
			previewClassName={ styles.siteDragPreview }
			placeholderTestId="plugin-drop-placeholder"
			itemIdAttribute="data-site-id"
			excludeSelector="[data-site-actions]"
		/>
	);

	// The "All" view drags across the full combined list, so its order is the
	// persisted order verbatim.
	const allRowsBlock = (
		<ReorderableList
			items={ rows }
			getItemId={ getRowSiteId }
			renderItem={ renderSiteRow }
			onReorder={ persistOrder }
			className={ styles.sites }
			itemClassName={ styles.siteDragWrapper }
			placeholderClassName={ styles.siteDropPlaceholder }
			previewClassName={ styles.siteDragPreview }
			placeholderTestId="site-drop-placeholder"
			itemIdAttribute="data-site-id"
			excludeSelector="[data-site-actions]"
		/>
	);

	const isLoading = sitesLoading || sessionsLoading;
	const baseRows = view === 'plugins' ? pluginSiteRows : view === 'sites' ? siteRows : rows;
	const searchLabel =
		view === 'plugins'
			? __( 'Search plugins' )
			: view === 'sites'
			? __( 'Search sites' )
			: __( 'Search' );
	const query = searchQuery.trim().toLowerCase();

	// A search or a derived sort renders a plain (non-draggable) list; manual
	// ordering only makes sense against the full custom-ordered list.
	const derivedRows = useMemo( () => {
		if ( ! query && sort === 'custom' ) {
			return null;
		}
		const filtered = query
			? baseRows.filter( ( row ) => row.site.name.toLowerCase().includes( query ) )
			: baseRows;
		return [ ...filtered ].sort( ( a, b ) => compareRows( a, b, sort, creationRank ) );
	}, [ baseRows, query, sort, creationRank ] );

	let listContent: ReactNode;
	if ( isLoading ) {
		listContent = <p className={ styles.empty }>{ __( 'Loading…' ) }</p>;
	} else if ( baseRows.length === 0 ) {
		listContent = (
			<p className={ styles.empty }>
				{ view === 'plugins'
					? __( 'No plugins yet' )
					: view === 'sites'
					? __( 'No sites yet' )
					: __( 'Nothing yet' ) }
			</p>
		);
	} else if ( derivedRows ) {
		listContent =
			derivedRows.length === 0 ? (
				<p className={ styles.empty }>{ __( 'No matches' ) }</p>
			) : (
				renderStaticRows( derivedRows )
			);
	} else if ( view === 'sites' && groupSections.length > 0 ) {
		// Grouped sidebar: accordion sections per group, ungrouped sites under
		// a trailing "Other" section. Rows render static — dragging across
		// group boundaries is out of scope for the prototype.
		listContent = (
			<>
				{ groupSections.map( ( { group, groupRows } ) => (
					<div key={ group.id } className={ styles.group }>
						<GroupHeading
							label={ group.name }
							isOpen={ ! group.collapsed }
							onToggle={ () => toggleSiteGroupCollapsed( group.id ) }
							onUngroup={ () => removeSiteGroup( group.id ) }
						/>
						{ ! group.collapsed && renderStaticRows( groupRows ) }
					</div>
				) ) }
				{ ungroupedRows.length > 0 ? (
					<div className={ styles.group }>
						<GroupHeading
							label={ __( 'Other' ) }
							isOpen={ ! otherGroupCollapsed }
							onToggle={ () => setOtherGroupCollapsed( ( value ) => ! value ) }
						/>
						{ ! otherGroupCollapsed && renderStaticRows( ungroupedRows ) }
					</div>
				) : null }
			</>
		);
	} else {
		listContent =
			view === 'plugins' ? pluginRowsBlock : view === 'sites' ? siteRowsBlock : allRowsBlock;
	}

	return (
		<div className={ styles.root } ref={ listAnchorRef }>
			<div className={ styles.viewSwitcherBar }>
				<SegmentedControl
					aria-label={ __( 'Project type' ) }
					value={ view }
					onChange={ selectView }
					options={ [
						{
							value: 'all',
							label: <Icon icon={ category } size={ 16 } />,
							tooltip: __( 'All' ),
						},
						{
							value: 'sites',
							label: <Icon icon={ wordpress } size={ 16 } />,
							tooltip: __( 'Sites' ),
						},
						{
							value: 'plugins',
							label: <Icon icon={ pluginsIcon } size={ 16 } />,
							tooltip: __( 'Plugins' ),
						},
					] }
				/>
				<div className={ styles.searchRow }>
					<div className={ styles.searchField }>
						<input
							type="search"
							className={ styles.searchInput }
							placeholder={ searchLabel }
							aria-label={ searchLabel }
							value={ searchQuery }
							onChange={ ( event ) => setSearchQuery( event.target.value ) }
						/>
						<Menu.Root modal={ false }>
							<Menu.Trigger
								render={
									<IconButton
										variant="minimal"
										tone={ sort === 'custom' ? 'neutral' : 'brand' }
										size="small"
										icon={ funnel }
										label={ __( 'Sort' ) }
									/>
								}
							/>
							<Menu.Popup side="bottom" align="end">
								<Menu.Group>
									<Menu.GroupLabel>{ __( 'Sort by' ) }</Menu.GroupLabel>
									<Menu.RadioGroup
										value={ sort }
										onValueChange={ ( next ) => selectSort( next as SidebarSort ) }
									>
										<Menu.RadioItem value="custom">{ __( 'Custom order' ) }</Menu.RadioItem>
										<Menu.RadioItem value="name-asc">{ __( 'Name, A to Z' ) }</Menu.RadioItem>
										<Menu.RadioItem value="name-desc">{ __( 'Name, Z to A' ) }</Menu.RadioItem>
										<Menu.RadioItem value="running-first">{ __( 'Running first' ) }</Menu.RadioItem>
										<Menu.RadioItem value="created-desc">{ __( 'Newest first' ) }</Menu.RadioItem>
										<Menu.RadioItem value="created-asc">{ __( 'Oldest first' ) }</Menu.RadioItem>
									</Menu.RadioGroup>
								</Menu.Group>
								{ view === 'sites' ? (
									<>
										<Menu.Separator />
										<Menu.Item onClick={ () => setSelectModeOn( true ) }>
											{ __( 'Select sites to group' ) }
										</Menu.Item>
									</>
								) : null }
							</Menu.Popup>
						</Menu.Root>
					</div>
				</div>
				{ selecting ? (
					<div className={ styles.selectionBar }>
						{ groupNaming ? (
							<>
								{ /* The input appears on explicit user action; moving focus
								     into it follows the intent. */ }
								<input
									className={ styles.groupNameInput }
									autoFocus
									placeholder={ __( 'Group name' ) }
									aria-label={ __( 'Group name' ) }
									value={ groupName }
									onChange={ ( event ) => setGroupName( event.target.value ) }
									onKeyDown={ ( event ) => {
										if ( event.key === 'Enter' ) {
											submitGroup();
										} else if ( event.key === 'Escape' ) {
											setGroupNaming( false );
											setGroupName( '' );
										}
									} }
								/>
								<Button
									size="small"
									variant="solid"
									tone="brand"
									disabled={ ! groupName.trim() }
									onClick={ submitGroup }
								>
									{ __( 'Save' ) }
								</Button>
							</>
						) : (
							<>
								<span className={ styles.selectionCount }>
									{ sprintf(
										/* translators: %d: number of selected sites */
										__( '%d selected' ),
										selectedSiteIds.size
									) }
								</span>
								<Button
									size="small"
									variant="solid"
									tone="brand"
									disabled={ selectedSiteIds.size === 0 }
									onClick={ () => setGroupNaming( true ) }
								>
									{ __( 'Create group' ) }
								</Button>
							</>
						) }
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ closeSmall }
							label={ __( 'Cancel selection' ) }
							onClick={ clearSelection }
						/>
					</div>
				) : null }
			</div>
			{ listContent }
		</div>
	);
}
