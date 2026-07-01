import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { settings } from '@wordpress/icons';
import { IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	Fragment,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from 'react';
import { SidebarButton } from '@/components/sidebar-button';
import { deriveSiteStatus } from '@/components/site-dropdown/utils';
import { Spinner } from '@/components/spinner';
import { useSiteAgentActivity, type SiteAgentActivity } from '@/data/queries/use-agent-run';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

type SiteRow = {
	site: SiteDetails;
	latestSession?: AiSessionSummary;
	sessionIds: string[];
};

type SiteRowActivity = SiteAgentActivity | 'new-message' | 'sync';

type ActiveSiteDrag = {
	siteId: string;
	currentY: number;
	dropIndex: number;
	pointerOffsetY: number;
	previewLeft: number;
	previewWidth: number;
};

type SiteDragCandidate = {
	siteId: string;
	pointerId: number | undefined;
	startX: number;
	startY: number;
	pointerOffsetY: number;
	previewLeft: number;
	previewWidth: number;
};

const ACTIVITY_EXIT_DURATION_MS = 180;
const SITE_DRAG_START_THRESHOLD = 4;
const SITE_DRAG_REORDER_DURATION_MS = 160;
const SITE_DRAG_REORDER_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const SITE_DRAG_REORDER_DISTANCE_EPSILON = 0.5;
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
					<Spinner className={ styles.siteAgentActivitySpinner } label={ workingLabel } />
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
}: {
	site: SiteDetails;
	isActive?: boolean;
} ) {
	const navigate = useNavigate();

	return (
		<IconButton
			variant="minimal"
			tone="neutral"
			size="small"
			icon={ settings }
			label={ __( 'Site overview' ) }
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
}: {
	row: SiteRow;
	isChatActive: boolean;
	isContextActive: boolean;
	hasUnreadUpdate?: boolean;
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

	return (
		<section
			className={ clsx(
				styles.site,
				isChatActive && styles.siteActive,
				isContextActive && styles.siteContextActive
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
						aria-current={ isChatActive ? 'page' : undefined }
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
					<SiteOverviewButton site={ site } isActive={ isContextActive } />
					<SiteStatusButton site={ site } isStarting={ isStarting } isStopping={ isStopping } />
				</div>
			</header>
		</section>
	);
}

function insertSiteIdAtIndex( siteIds: string[], movedSiteId: string, targetIndex: number ) {
	const fromIndex = siteIds.indexOf( movedSiteId );
	if ( fromIndex === -1 ) {
		return siteIds;
	}

	const nextSiteIds = [ ...siteIds ];
	const [ movedSite ] = nextSiteIds.splice( fromIndex, 1 );
	nextSiteIds.splice( Math.max( 0, Math.min( targetIndex, nextSiteIds.length ) ), 0, movedSite );
	return nextSiteIds;
}

function measureSiteRowRects( rowElements: Map< string, HTMLDivElement > ) {
	const rects = new Map< string, DOMRectReadOnly >();
	for ( const [ siteId, element ] of rowElements ) {
		rects.set( siteId, element.getBoundingClientRect() );
	}
	return rects;
}

function getSiteRowAnimationTarget( rowElement: HTMLDivElement ) {
	const target = rowElement.firstElementChild;
	return target instanceof HTMLElement ? target : rowElement;
}

function prefersReducedMotion() {
	return window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ?? false;
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
	const [ activeDrag, setActiveDrag ] = useState< ActiveSiteDrag | null >( null );
	const activeDragRef = useRef< ActiveSiteDrag | null >( null );
	const dragCandidateRef = useRef< SiteDragCandidate | null >( null );
	const dragStartSiteOrderRef = useRef< string[] >( [] );
	const rowElementsRef = useRef< Map< string, HTMLDivElement > >( new Map() );
	const previousRowRectsRef = useRef< Map< string, DOMRectReadOnly > >( new Map() );
	const dragStartRowRectsRef = useRef< Map< string, DOMRectReadOnly > >( new Map() );
	const rowMoveAnimationsRef = useRef< Map< string, Animation > >( new Map() );
	const suppressNextClickRef = useRef( false );
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
	const rowSiteIds = useMemo( () => rows.map( ( row ) => row.site.id ), [ rows ] );
	const activeDragSiteId = activeDrag?.siteId;
	const activeDropIndex = activeDrag?.dropIndex;
	const isDraggingSites = activeDrag !== null;
	const displayRows = useMemo(
		() => rows.filter( ( row ) => row.site.id !== activeDragSiteId ),
		[ rows, activeDragSiteId ]
	);
	const draggedRow = activeDragSiteId
		? rows.find( ( row ) => row.site.id === activeDragSiteId )
		: undefined;

	useLayoutEffect( () => {
		const nextRowRects = measureSiteRowRects( rowElementsRef.current );
		const previousRowRects = previousRowRectsRef.current;
		const shouldAnimateRows = isDraggingSites && ! prefersReducedMotion();

		if ( shouldAnimateRows ) {
			for ( const [ siteId, nextRect ] of nextRowRects ) {
				const previousRect = previousRowRects.get( siteId );
				const rowElement = rowElementsRef.current.get( siteId );
				if ( ! previousRect || ! rowElement ) {
					continue;
				}

				const deltaX = previousRect.left - nextRect.left;
				const deltaY = previousRect.top - nextRect.top;
				if (
					Math.abs( deltaX ) < SITE_DRAG_REORDER_DISTANCE_EPSILON &&
					Math.abs( deltaY ) < SITE_DRAG_REORDER_DISTANCE_EPSILON
				) {
					continue;
				}

				const animationTarget = getSiteRowAnimationTarget( rowElement );
				if ( typeof animationTarget.animate !== 'function' ) {
					continue;
				}

				rowMoveAnimationsRef.current.get( siteId )?.cancel();
				const animation = animationTarget.animate(
					[
						{ transform: `translate(${ deltaX }px, ${ deltaY }px)` },
						{ transform: 'translate(0, 0)' },
					],
					{
						duration: SITE_DRAG_REORDER_DURATION_MS,
						easing: SITE_DRAG_REORDER_EASING,
					}
				);

				rowMoveAnimationsRef.current.set( siteId, animation );
				const clearAnimation = () => {
					if ( rowMoveAnimationsRef.current.get( siteId ) === animation ) {
						rowMoveAnimationsRef.current.delete( siteId );
					}
				};
				animation.onfinish = clearAnimation;
				animation.oncancel = clearAnimation;
			}
		}

		previousRowRectsRef.current = nextRowRects;
	}, [ activeDragSiteId, activeDropIndex, displayRows, isDraggingSites ] );

	const updateActiveDrag = ( nextDrag: ActiveSiteDrag | null ) => {
		activeDragRef.current = nextDrag;
		setActiveDrag( nextDrag );
	};

	const resetDragState = () => {
		dragCandidateRef.current = null;
		dragStartSiteOrderRef.current = [];
		updateActiveDrag( null );
	};

	// Hit-test against the rows' settled positions captured at drag start, not
	// their live rects. The placeholder shifting rows around mid-drag would make
	// live measurement circular, and reading `getBoundingClientRect` per row on
	// every pointermove forces a layout reflow each frame.
	const getDropIndex = ( clientY: number, draggedSiteId: string ) => {
		const sourceOrder =
			dragStartSiteOrderRef.current.length > 0 ? dragStartSiteOrderRef.current : rowSiteIds;
		const rowRects = dragStartRowRectsRef.current;

		let index = 0;
		for ( const siteId of sourceOrder ) {
			if ( siteId === draggedSiteId ) {
				continue;
			}
			const rowRect = rowRects.get( siteId );
			if ( ! rowRect ) {
				continue;
			}
			if ( clientY < rowRect.top + rowRect.height / 2 ) {
				return index;
			}
			index += 1;
		}
		return index;
	};

	const handleWindowPointerMove = ( event: PointerEvent ) => {
		const candidate = dragCandidateRef.current;
		if (
			! candidate ||
			( candidate.pointerId !== undefined &&
				event.pointerId !== undefined &&
				event.pointerId !== candidate.pointerId )
		) {
			return;
		}
		const active = activeDragRef.current;
		const deltaX = event.clientX - candidate.startX;
		const deltaY = event.clientY - candidate.startY;
		if ( ! active && Math.hypot( deltaX, deltaY ) < SITE_DRAG_START_THRESHOLD ) {
			return;
		}

		event.preventDefault();
		updateActiveDrag( {
			siteId: candidate.siteId,
			currentY: event.clientY,
			dropIndex: getDropIndex( event.clientY, candidate.siteId ),
			pointerOffsetY: candidate.pointerOffsetY,
			previewLeft: candidate.previewLeft,
			previewWidth: candidate.previewWidth,
		} );
	};

	const handleWindowPointerUp = ( event: PointerEvent ) => {
		const candidate = dragCandidateRef.current;
		if (
			! candidate ||
			( candidate.pointerId !== undefined &&
				event.pointerId !== undefined &&
				event.pointerId !== candidate.pointerId )
		) {
			return;
		}
		const active = activeDragRef.current;
		if ( active ) {
			const sourceOrder =
				dragStartSiteOrderRef.current.length > 0 ? dragStartSiteOrderRef.current : rowSiteIds;
			const nextSiteIds = insertSiteIdAtIndex( sourceOrder, active.siteId, active.dropIndex );
			setManualSiteOrder( nextSiteIds );
			writeStoredSiteOrder( nextSiteIds );
			suppressNextClickRef.current = true;
		}
		resetDragState();
		window.removeEventListener( 'pointermove', handleWindowPointerMove );
		window.removeEventListener( 'pointerup', handleWindowPointerUp );
	};

	const handlePointerDown = ( event: ReactPointerEvent< HTMLElement >, row: SiteRow ) => {
		if ( event.button !== 0 || ( event.target as HTMLElement ).closest( '[data-site-actions]' ) ) {
			return;
		}
		const rowRect = event.currentTarget.getBoundingClientRect();
		dragStartSiteOrderRef.current = rowSiteIds;
		const dragStartRowRects = measureSiteRowRects( rowElementsRef.current );
		previousRowRectsRef.current = dragStartRowRects;
		dragStartRowRectsRef.current = dragStartRowRects;
		dragCandidateRef.current = {
			siteId: row.site.id,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			pointerOffsetY: event.clientY - rowRect.top,
			previewLeft: rowRect.left,
			previewWidth: rowRect.width,
		};
		window.addEventListener( 'pointermove', handleWindowPointerMove, { passive: false } );
		window.addEventListener( 'pointerup', handleWindowPointerUp );
	};

	const handleClickCapture = ( event: MouseEvent< HTMLElement > ) => {
		if ( ! suppressNextClickRef.current ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		suppressNextClickRef.current = false;
	};

	return (
		<div className={ styles.root }>
			{ sitesLoading || sessionsLoading ? (
				<p className={ styles.empty }>{ __( 'Loading…' ) }</p>
			) : rows.length === 0 ? (
				<p className={ styles.empty }>{ __( 'No sites yet' ) }</p>
			) : (
				<div className={ clsx( styles.sites, activeDrag && styles.sitesDragging ) }>
					{ displayRows.map( ( row, index ) => (
						<Fragment key={ row.site.id }>
							{ activeDrag && activeDrag.dropIndex === index ? (
								<div
									className={ styles.siteDropPlaceholder }
									data-testid="site-drop-placeholder"
									aria-hidden="true"
								/>
							) : null }
							<div
								ref={ ( node ) => {
									if ( node ) {
										rowElementsRef.current.set( row.site.id, node );
									} else {
										rowElementsRef.current.delete( row.site.id );
									}
								} }
								className={ styles.siteDragWrapper }
								data-site-id={ row.site.id }
								onPointerDown={ ( event ) => handlePointerDown( event, row ) }
								onClickCapture={ handleClickCapture }
							>
								<SiteSection
									row={ row }
									isChatActive={ row.site.id === activeChatSiteKey }
									isContextActive={ row.site.id === activeContextSiteKey }
									hasUnreadUpdate={ unreadSiteIds.has( row.site.id ) }
								/>
							</div>
						</Fragment>
					) ) }
					{ activeDrag && activeDrag.dropIndex === displayRows.length ? (
						<div
							className={ styles.siteDropPlaceholder }
							data-testid="site-drop-placeholder"
							aria-hidden="true"
						/>
					) : null }
				</div>
			) }
			{ activeDrag && draggedRow ? (
				<div
					className={ styles.siteDragPreview }
					style={
						{
							inlineSize: activeDrag.previewWidth,
							insetBlockStart: activeDrag.currentY - activeDrag.pointerOffsetY,
							insetInlineStart: activeDrag.previewLeft,
						} as CSSProperties
					}
					aria-hidden="true"
				>
					<SiteSection
						row={ draggedRow }
						isChatActive={ draggedRow.site.id === activeChatSiteKey }
						isContextActive={ draggedRow.site.id === activeContextSiteKey }
						hasUnreadUpdate={ unreadSiteIds.has( draggedRow.site.id ) }
					/>
				</div>
			) : null }
		</div>
	);
}
