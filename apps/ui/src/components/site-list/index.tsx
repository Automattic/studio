import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { sortSites } from '@studio/common/lib/sort-sites';
import { supportedEditorConfig } from '@studio/common/lib/user-settings/editor';
import { terminalConfig } from '@studio/common/lib/user-settings/terminal';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { settings } from '@wordpress/icons';
import { IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	useEffect,
	useMemo,
	useState,
	type MouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactElement,
	type ReactNode,
} from 'react';
import { AgentWorkingIndicator } from '@/components/agent-working-indicator';
import { DeleteSiteDialog } from '@/components/delete-site-dialog';
import * as Menu from '@/components/menu';
import { ReorderableList } from '@/components/reorderable-list';
import { SidebarButton } from '@/components/sidebar-button';
import { deriveSiteStatus } from '@/components/site-dropdown/utils';
import { useConnector } from '@/data/core';
import { useSiteAgentActivity, type SiteAgentActivity } from '@/data/queries/use-agent-run';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useCopySite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSites,
	useStartSite,
	useStopSite,
	useUpdateSitesSortOrder,
} from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { getSiteUrl } from '@/lib/get-site-url';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

type SiteRow = {
	site: SiteDetails;
	latestSession?: AiSessionSummary;
	sessionIds: string[];
};

type SiteRowActivity = SiteAgentActivity | 'new-message' | 'sync';

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

// Same glyph as Classic's `XDebugIcon` (apps/studio/src/components/icons/
// xdebug-icon.tsx), recolored via `currentColor` for the wpds theme.
const XDEBUG_ICON_PATH =
	'M14.5002 10.4214C14.9651 10.4215 15.3419 10.7983 15.342 11.2632V11.7075L16.6741 11.1333C16.9089 11.0319 17.1821 11.1397 17.2834 11.3745C17.3848 11.6094 17.2761 11.8825 17.0413 11.9839L15.342 12.7163V14.6313L16.97 15.5581C17.1923 15.6846 17.2703 15.9676 17.1438 16.1899C17.0173 16.4121 16.7342 16.4902 16.512 16.3638L15.2219 15.6294C14.8413 16.9968 13.5886 18.0005 12.0999 18.0005C10.6204 18.0004 9.37355 17.0092 8.98462 15.6548L7.7395 16.3638C7.51719 16.4902 7.23416 16.4122 7.10767 16.1899C6.9812 15.9676 7.05914 15.6846 7.28149 15.5581L8.85767 14.6616V12.6802L7.24243 11.9839C7.00757 11.8825 6.89985 11.6094 7.00122 11.3745C7.10268 11.1398 7.37485 11.032 7.60962 11.1333L8.85767 11.6714V11.2632C8.85782 10.7984 9.23464 10.4216 9.69946 10.4214H14.5002ZM13.7483 6.18896C13.8999 5.98302 14.1897 5.93884 14.3958 6.09033C14.6016 6.24192 14.6458 6.53181 14.4944 6.73779L13.7874 7.69873C14.1762 8.09284 14.4163 8.62971 14.4163 9.24268C14.4161 9.48774 14.1995 9.66352 13.9543 9.66357H10.2454C10.0003 9.66345 9.78462 9.48769 9.78442 9.24268C9.78442 8.65527 10.0041 8.13759 10.3645 7.74854L9.62134 6.73779C9.46987 6.53179 9.5141 6.24192 9.71997 6.09033C9.92601 5.93883 10.2159 5.98299 10.3674 6.18896L11.1213 7.21338C11.4188 7.08356 11.7499 7.01026 12.0999 7.01025C12.4248 7.01025 12.7342 7.07232 13.0149 7.18506L13.7483 6.18896Z';

function SiteOverviewButton( { site }: { site: SiteDetails } ) {
	const navigate = useNavigate();

	return (
		<IconButton
			variant="minimal"
			tone="neutral"
			size="small"
			icon={ settings }
			label={ __( 'Site overview' ) }
			className={ styles.siteAction }
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
	const xdebug = Boolean( site.enableXdebug );
	const tooltipLabel = xdebug
		? sprintf( __( 'Site status: %s. Xdebug enabled' ), statusName )
		: sprintf( __( 'Site status: %s' ), statusName );
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
						data-xdebug={ xdebug || undefined }
						onClick={ handleClick }
					>
						{ xdebug ? (
							<svg
								className={ clsx( styles.siteStatusGlyph, styles.siteStatusXdebugGlyph ) }
								viewBox="0 0 24 24"
								aria-hidden="true"
								focusable="false"
							>
								<path d={ XDEBUG_ICON_PATH } fill="currentColor" />
							</svg>
						) : (
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
						) }
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

// Right-click quick actions for a sidebar site row. The row element itself is
// passed as `trigger` and rendered via the context-menu trigger's render prop,
// so no wrapper DOM is added around it (the sidebar's drag-reorder CSS and
// animation code rely on the row's DOM position).
function SiteActionsMenu( {
	site,
	sessionIds,
	isStarting,
	isStopping,
	trigger,
}: {
	site: SiteDetails;
	sessionIds: string[];
	isStarting: boolean;
	isStopping: boolean;
	trigger: ReactElement;
} ) {
	const navigate = useNavigate();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const connector = useConnector();
	const { data: userPreferences } = useUserPreferences();
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const busy = isStarting || isStopping;
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;
	const [ deleteOpen, setDeleteOpen ] = useState( false );

	const stopMenuEventPropagation = (
		event: MouseEvent< HTMLElement > | ReactPointerEvent< HTMLElement >
	) => {
		event.stopPropagation();
	};

	const handleOpenFolder = () => {
		void connector.openSiteFolder( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site folder:', error );
		} );
	};

	const editor = userPreferences?.editor;
	const editorLabel = editor ? supportedEditorConfig[ editor ].label : null;
	const terminal = userPreferences?.terminal;
	const terminalLabel = terminal ? terminalConfig[ terminal ].name : null;

	const handleOpenInEditor = () => {
		void connector.openSiteInEditor( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site in editor:', error );
		} );
	};

	const handleOpenInTerminal = () => {
		void connector.openSiteInTerminal( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site in terminal:', error );
		} );
	};

	const handleOpenPhpMyAdmin = () => {
		void connector.openExternalUrl(
			`${ getSiteUrl( site ) }/phpmyadmin/index.php?route=/database/structure&db=wordpress`
		);
	};

	const handleOpenWpAdmin = () => {
		const siteUrl = getSiteUrl( site );
		const redirectTo = new URL( '/wp-admin/', siteUrl ).toString();
		const autoLoginUrl = new URL( '/studio-auto-login', siteUrl );
		autoLoginUrl.searchParams.set( 'redirect_to', redirectTo );
		void connector.openExternalUrl( autoLoginUrl.toString() );
	};

	const handleDeleted = () => {
		const viewingDeletedSite =
			params.siteId === site.id ||
			( params.sessionId ? sessionIds.includes( params.sessionId ) : false );
		if ( viewingDeletedSite ) {
			void navigate( { to: '/' } );
		}
	};

	return (
		<>
			<Menu.ContextMenuRoot>
				<Menu.ContextMenuTrigger render={ trigger } />
				<Menu.ContextPopup
					onClick={ stopMenuEventPropagation }
					onPointerDown={ stopMenuEventPropagation }
				>
					{ site.running ? (
						<Menu.Item disabled={ busy } onClick={ () => stopSite.mutate( site.id ) }>
							{ __( 'Stop site' ) }
						</Menu.Item>
					) : (
						<Menu.Item disabled={ busy } onClick={ () => startSite.mutate( site.id ) }>
							{ isStarting ? __( 'Starting…' ) : __( 'Start site' ) }
						</Menu.Item>
					) }
					<Menu.Separator />
					<Menu.Item
						onClick={ () =>
							void navigate( {
								to: '/sites/$siteId/overview',
								params: { siteId: site.id },
								search: { tab: 'general' },
							} )
						}
					>
						{ __( 'Site settings' ) }
					</Menu.Item>
					<Menu.Item disabled={ copySite.isPending } onClick={ () => copySite.mutate( site.id ) }>
						{ copySite.isPending ? __( 'Duplicating…' ) : __( 'Duplicate site' ) }
					</Menu.Item>
					<Menu.Separator />
					<Menu.Item onClick={ handleOpenFolder }>{ __( 'Open folder' ) }</Menu.Item>
					{ editorLabel ? (
						<Menu.Item onClick={ handleOpenInEditor }>
							{ sprintf(
								/* translators: %s is the name of the editor. E.g. "Open in Cursor" */
								__( 'Open in %s' ),
								editorLabel
							) }
						</Menu.Item>
					) : null }
					{ terminalLabel ? (
						<Menu.Item onClick={ handleOpenInTerminal }>
							{ sprintf(
								/* translators: %s is the name of the terminal app. E.g. "Open in iTerm2" */
								__( 'Open in %s' ),
								terminalLabel
							) }
						</Menu.Item>
					) : null }
					<Menu.Item disabled={ ! site.running } onClick={ handleOpenPhpMyAdmin }>
						{ __( 'Open phpMyAdmin' ) }
					</Menu.Item>
					<Menu.Item disabled={ ! site.running } onClick={ handleOpenWpAdmin }>
						{ __( 'Open WP admin' ) }
					</Menu.Item>
					<Menu.Separator />
					<Menu.Item disabled={ isExporting } onClick={ () => exportFullSite.mutate( site.id ) }>
						{ exportFullSite.isPending ? __( 'Exporting…' ) : __( 'Export entire site' ) }
					</Menu.Item>
					<Menu.Item disabled={ isExporting } onClick={ () => exportDatabase.mutate( site.id ) }>
						{ exportDatabase.isPending ? __( 'Exporting…' ) : __( 'Export database' ) }
					</Menu.Item>
					<Menu.Separator />
					<Menu.Item
						onClick={ () => setDeleteOpen( true ) }
						disabled={ busy || copySite.isPending || isExporting }
					>
						{ __( 'Delete site' ) }
					</Menu.Item>
				</Menu.ContextPopup>
			</Menu.ContextMenuRoot>
			<DeleteSiteDialog
				site={ site }
				open={ deleteOpen }
				onOpenChange={ setDeleteOpen }
				onDeleted={ handleDeleted }
			/>
		</>
	);
}

function SiteSection( {
	row,
	isChatActive,
	isContextActive,
	hasUnreadUpdate,
	agenticEnabled,
}: {
	row: SiteRow;
	isChatActive: boolean;
	isContextActive: boolean;
	hasUnreadUpdate: boolean;
	agenticEnabled: boolean;
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
		// Without agentic features (e.g. signed out) there's no chat to open;
		// the site overview is the site's home instead.
		if ( ! agenticEnabled ) {
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

	return (
		<section
			className={ clsx(
				styles.site,
				isChatActive && styles.siteActive,
				isContextActive && styles.siteContextActive
			) }
		>
			<SiteActionsMenu
				site={ site }
				sessionIds={ row.sessionIds }
				isStarting={ isStarting }
				isStopping={ isStopping }
				trigger={
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
						<div className={ styles.siteActions } data-reorder-exclude>
							<SiteOverviewButton site={ site } />
							<SiteStatusButton site={ site } isStarting={ isStarting } isStopping={ isStopping } />
						</div>
					</header>
				}
			/>
		</section>
	);
}

function findSessionSiteKey(
	rows: SiteRow[],
	activeSessionId: string | undefined
): string | undefined {
	if ( ! activeSessionId ) {
		return undefined;
	}
	return rows.find( ( row ) => row.sessionIds.includes( activeSessionId ) )?.site.id;
}

export function SiteList() {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();
	const { enabled: agenticEnabled } = useAgenticFeatures();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const activeSessionId = params.sessionId;
	const activeSiteId = params.siteId;
	const [ manualSiteOrder, setManualSiteOrder ] = useState< string[] >( [] );
	const updateSitesSortOrder = useUpdateSitesSortOrder();
	const [ seenSiteSessionTimestampsInitialized, setSeenSiteSessionTimestampsInitialized ] =
		useState( false );
	const [ seenSiteSessionTimestamps, setSeenSiteSessionTimestamps ] = useState<
		Record< string, number >
	>( {} );

	const orderedSites = useMemo(
		() => sortSitesByManualOrder( sortSites( [ ...( sites ?? [] ) ] ), manualSiteOrder ),
		[ sites, manualSiteOrder ]
	);
	const rows = useMemo(
		() => createSiteRows( orderedSites, sessions ),
		[ orderedSites, sessions ]
	);
	const activeChatSiteKey = useMemo(
		() => findSessionSiteKey( rows, activeSessionId ),
		[ rows, activeSessionId ]
	);
	// Site ids are UUIDs, so no URL decoding is needed to compare the path.
	const activeContextSiteKey =
		activeSiteId && pathname === `/sites/${ activeSiteId }/overview` ? activeSiteId : undefined;
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
				if ( shouldSeedSeenTimestamps || row.site.id === activeChatSiteKey ) {
					updateSeenTimestamp( row.site.id, latestTimestamp );
				}
			}

			return changed ? next : current;
		} );
		if ( ! seenSiteSessionTimestampsInitialized ) {
			setSeenSiteSessionTimestampsInitialized( true );
		}
	}, [
		activeChatSiteKey,
		rows,
		seenSiteSessionTimestampsInitialized,
		sessionsLoading,
		sitesLoading,
	] );
	const unreadSiteIds = useMemo( () => {
		if ( ! seenSiteSessionTimestampsInitialized ) {
			return new Set< string >();
		}
		const unread = new Set< string >();
		for ( const row of rows ) {
			if ( row.site.id === activeChatSiteKey ) {
				continue;
			}
			const latestTimestamp = getTimestamp( row.latestSession );
			if ( latestTimestamp > ( seenSiteSessionTimestamps[ row.site.id ] ?? 0 ) ) {
				unread.add( row.site.id );
			}
		}
		return unread;
	}, [ activeChatSiteKey, rows, seenSiteSessionTimestamps, seenSiteSessionTimestampsInitialized ] );

	const persistOrder = ( nextSiteIds: string[] ) => {
		setManualSiteOrder( nextSiteIds );
		updateSitesSortOrder.mutate( nextSiteIds );
	};

	const renderSiteRow = ( row: SiteRow ) => (
		<SiteSection
			row={ row }
			isChatActive={ row.site.id === activeChatSiteKey }
			isContextActive={ row.site.id === activeContextSiteKey }
			hasUnreadUpdate={ unreadSiteIds.has( row.site.id ) }
			agenticEnabled={ agenticEnabled }
		/>
	);

	let listContent: ReactNode;
	if ( sitesLoading || sessionsLoading ) {
		listContent = <p className={ styles.empty }>{ __( 'Loading…' ) }</p>;
	} else if ( rows.length === 0 ) {
		listContent = <p className={ styles.empty }>{ __( 'No sites yet' ) }</p>;
	} else {
		listContent = (
			<ReorderableList
				items={ rows }
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

	return <div className={ styles.root }>{ listContent }</div>;
}
