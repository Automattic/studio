import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronRight, settings } from '@wordpress/icons';
import { Icon, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import { ReorderableList } from '@/components/reorderable-list';
import { SidebarButton } from '@/components/sidebar-button';
import { SiteContextMenu } from '@/components/site-context-menu';
import { deriveSiteStatus } from '@/components/site-dropdown/utils';
import { useSiteAgentActivity, type SiteAgentActivity } from '@/data/queries/use-agent-run';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { usePluginSiteTags } from '@/lib/plugin-prototype';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

type SiteRow = {
	site: SiteDetails;
	latestSession?: AiSessionSummary;
	sessionIds: string[];
};

type SiteRowActivity = SiteAgentActivity | 'new-message' | 'sync';

const ACTIVITY_EXIT_DURATION_MS = 180;
const SITE_ORDER_STORAGE_KEY = 'studio-ui-site-list-order-v1';

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
	const newMessageLabel = __( 'New message' );
	const syncLabel = __( 'Syncing live site' );

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
	);
}

function getTimestamp( session: AiSessionSummary | undefined ): number {
	return session ? Date.parse( session.updatedAt ) || 0 : 0;
}

function readStoredSiteOrder(): string[] {
	try {
		const stored = window.localStorage.getItem( SITE_ORDER_STORAGE_KEY );
		const parsed = stored ? JSON.parse( stored ) : [];
		return Array.isArray( parsed )
			? parsed.filter( ( id ): id is string => typeof id === 'string' )
			: [];
	} catch {
		return [];
	}
}

function writeStoredSiteOrder( siteIds: string[] ): void {
	try {
		window.localStorage.setItem( SITE_ORDER_STORAGE_KEY, JSON.stringify( siteIds ) );
	} catch {
		// Ignore storage failures; drag order still updates for this render.
	}
}

function sortSitesByManualOrder(
	sites: SiteDetails[] | undefined,
	manualOrder: string[]
): SiteDetails[] {
	const sourceSites = sites ?? [];
	if ( manualOrder.length === 0 ) {
		return sourceSites;
	}

	const sitesById = new Map( sourceSites.map( ( site ) => [ site.id, site ] ) );
	const orderedIds = new Set< string >();
	const orderedSites: SiteDetails[] = [];

	for ( const siteId of manualOrder ) {
		const site = sitesById.get( siteId );
		if ( site ) {
			orderedIds.add( siteId );
			orderedSites.push( site );
		}
	}

	for ( const site of sourceSites ) {
		if ( ! orderedIds.has( site.id ) ) {
			orderedSites.push( site );
		}
	}

	return orderedSites;
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
	const rowsByPath = new Map( rows.map( ( row ) => [ row.site.path, row ] ) );

	for ( const session of sessions ?? [] ) {
		if ( ! session.ownerSitePath ) {
			continue;
		}
		const row = rowsByPath.get( session.ownerSitePath );
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
}: {
	site: SiteDetails;
	isActive?: boolean;
	isPlugin?: boolean;
} ) {
	const navigate = useNavigate();

	return (
		<IconButton
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
	agenticGated = false,
}: {
	row: SiteRow;
	isChatActive: boolean;
	isContextActive: boolean;
	hasUnreadUpdate?: boolean;
	// Prototype: true when this site is tagged as a plugin — only changes
	// the overview action's label; plugin rows otherwise look like sites.
	isPlugin?: boolean;
	// When agentic features are unavailable the row opens the overview
	// directly, making the dedicated overview button redundant.
	agenticGated?: boolean;
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
	const displayActivity = isLiveSyncPending
		? 'sync'
		: agentActivity !== 'idle'
		? agentActivity
		: hasUnreadUpdate
		? 'new-message'
		: 'idle';
	const handleOpenSite = () => {
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
						! agenticGated && isContextActive && styles.siteContextActive
					) }
				>
					<header className={ styles.siteHeader } onClick={ handleOpenSite }>
						<div className={ styles.siteText }>
							<SiteAgentActivityIndicator activity={ displayActivity } />
							<SidebarButton
								className={ styles.siteToggle }
								onClick={ ( event ) => {
									event.stopPropagation();
									handleOpenSite();
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

// Prototype: accordion heading for the grouped sidebar variant.
function GroupHeading( {
	label,
	isOpen,
	onToggle,
}: {
	label: string;
	isOpen: boolean;
	onToggle: () => void;
} ) {
	return (
		<button
			type="button"
			className={ styles.groupHeading }
			aria-expanded={ isOpen }
			onClick={ onToggle }
		>
			<span>{ label }</span>
			<Icon icon={ isOpen ? chevronDown : chevronRight } size={ 16 } />
		</button>
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
	const [ manualSiteOrder, setManualSiteOrder ] = useState( readStoredSiteOrder );
	// One subscription for the whole list; rows receive the resolved flag.
	const agenticFeatures = useAgenticFeatures();
	const agenticGated = agenticFeatures.isReady && ! agenticFeatures.enabled;
	// Prototype: plugin-tagged sites (see plugin-prototype.ts). Plugins are
	// just sites; tags only change where and how their rows render.
	const pluginTags = usePluginSiteTags();
	const [ isSitesGroupOpen, setIsSitesGroupOpen ] = useState( true );
	const [ isPluginsGroupOpen, setIsPluginsGroupOpen ] = useState( true );
	const [ seenSiteSessionTimestampsInitialized, setSeenSiteSessionTimestampsInitialized ] =
		useState( false );
	const [ seenSiteSessionTimestamps, setSeenSiteSessionTimestamps ] = useState<
		Record< string, number >
	>( {} );

	const orderedSites = useMemo(
		() => sortSitesByManualOrder( sites, manualSiteOrder ),
		[ sites, manualSiteOrder ]
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

	// Both groups persist into the single stored order (ordering is applied to
	// the full site list before the rows split into groups), so a drop in one
	// group merges its new order with the other group's current order.
	const persistOrder = ( nextSiteIds: string[] ) => {
		setManualSiteOrder( nextSiteIds );
		writeStoredSiteOrder( nextSiteIds );
	};

	const renderSiteRow = ( row: SiteRow, isPlugin = false ) => (
		<SiteSection
			row={ row }
			isPlugin={ isPlugin }
			isChatActive={ row.site.id === activeChatSiteKey }
			isContextActive={ row.site.id === activeContextSiteKey }
			hasUnreadUpdate={ unreadSiteIds.has( row.site.id ) }
			agenticGated={ agenticGated }
		/>
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
	// chat, overview all intact), draggable within their own group.
	const pluginRowsBlock = (
		<ReorderableList
			items={ pluginSiteRows }
			getItemId={ getRowSiteId }
			renderItem={ ( row ) => renderSiteRow( row, true ) }
			onReorder={ ( nextIds ) => persistOrder( [ ...rowSiteIds, ...nextIds ] ) }
			className={ clsx( styles.groupBody, styles.groupList ) }
			itemClassName={ styles.siteDragWrapper }
			placeholderClassName={ styles.siteDropPlaceholder }
			previewClassName={ styles.siteDragPreview }
			placeholderTestId="plugin-drop-placeholder"
			itemIdAttribute="data-site-id"
			excludeSelector="[data-site-actions]"
		/>
	);

	// Plugin-tagged sites get their own accordion group under the sites. The
	// headings only appear once a plugin exists — plugin-less sidebars keep
	// the plain flat site list.
	let listContent: ReactNode;
	if ( sitesLoading || sessionsLoading ) {
		listContent = <p className={ styles.empty }>{ __( 'Loading…' ) }</p>;
	} else if ( pluginSiteRows.length > 0 ) {
		listContent = (
			<>
				<GroupHeading
					label={ __( 'Sites' ) }
					isOpen={ isSitesGroupOpen }
					onToggle={ () => setIsSitesGroupOpen( ( value ) => ! value ) }
				/>
				{ isSitesGroupOpen && (
					<div className={ styles.groupBody }>
						{ siteRows.length === 0 ? (
							<p className={ styles.groupEmpty }>{ __( 'No sites yet' ) }</p>
						) : (
							siteRowsBlock
						) }
					</div>
				) }
				<GroupHeading
					label={ __( 'Plugins' ) }
					isOpen={ isPluginsGroupOpen }
					onToggle={ () => setIsPluginsGroupOpen( ( value ) => ! value ) }
				/>
				{ isPluginsGroupOpen && pluginRowsBlock }
			</>
		);
	} else if ( rows.length === 0 ) {
		listContent = <p className={ styles.empty }>{ __( 'No sites yet' ) }</p>;
	} else {
		listContent = siteRowsBlock;
	}

	return <div className={ styles.root }>{ listContent }</div>;
}
