import { sortSites } from '@studio/common/lib/sort-sites';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import {
	box,
	chevronDown,
	chevronRight,
	moreHorizontal,
	plus,
	starEmpty,
	starFilled,
} from '@wordpress/icons';
import { Button, Dialog, Icon, IconButton, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import * as Menu from '@/components/menu';
import { ReorderableList } from '@/components/reorderable-list';
import { SidebarButton } from '@/components/sidebar-button';
import { deriveSiteStatus } from '@/components/site-dropdown/utils';
import { SiteIcon } from '@/components/site-icon';
import { Spinner } from '@/components/spinner';
import { useConnector } from '@/data/core';
import { useIsSessionRunning, useSessionHasPendingQuestion } from '@/data/queries/use-agent-run';
import { useSessions, useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import {
	useCopySite,
	useDeleteSite,
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
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getSiteUrl } from '@/lib/get-site-url';
import styles from './style.module.css';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

const UNASSIGNED_KEY = '__unassigned__';

type SiteGroup = {
	key: string;
	site?: SiteDetails;
	label: string;
	sessions: AiSessionSummary[];
};

function groupSessionsByOwner(
	sites: SiteDetails[] | undefined,
	sessions: AiSessionSummary[] | undefined
): SiteGroup[] {
	const knownSitePaths = new Set( ( sites ?? [] ).map( ( site ) => site.path ) );
	const sessionsByPath = new Map< string, AiSessionSummary[] >();
	const unassigned: AiSessionSummary[] = [];

	for ( const session of sessions ?? [] ) {
		// Archived chats stay out of the sidebar; they remain reachable from
		// the session data and will get a dedicated list with the site
		// overview screens.
		if ( session.archived ) {
			continue;
		}
		if ( ! session.ownerSitePath || ! knownSitePaths.has( session.ownerSitePath ) ) {
			unassigned.push( session );
			continue;
		}

		const existing = sessionsByPath.get( session.ownerSitePath );
		if ( existing ) {
			existing.push( session );
		} else {
			sessionsByPath.set( session.ownerSitePath, [ session ] );
		}
	}

	// Groups keep the given site order (sorted by `sortOrder` upstream).
	const groups: SiteGroup[] = ( sites ?? [] ).map( ( site ) => ( {
		key: site.id,
		site,
		label: site.name,
		sessions: sessionsByPath.get( site.path ) ?? [],
	} ) );

	if ( unassigned.length > 0 ) {
		groups.push( {
			key: UNASSIGNED_KEY,
			label: __( 'Unassigned' ),
			sessions: unassigned,
		} );
	}

	return groups;
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

function SessionActionsMenu( { session }: { session: AiSessionSummary } ) {
	const updateSessionMetadata = useUpdateSessionMetadata();
	const isPending = updateSessionMetadata.isPending;
	const starred = !! session.starred;
	const archived = !! session.archived;

	// Same persistence path as the assistant tab: optimistic
	// starred/archived patches through `connector.updateSessionMetadata`.
	const updateMetadata = ( patch: { starred: boolean; archived: boolean } ) => {
		updateSessionMetadata.mutate( {
			sessionId: session.id,
			patch,
		} );
	};

	return (
		<Menu.Root modal={ false }>
			<Menu.Trigger
				render={
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ moreHorizontal }
						label={ __( 'Chat actions' ) }
						className={ styles.sessionAction }
						disabled={ isPending }
					/>
				}
			/>
			<Menu.Popup side="bottom" align="end">
				<Menu.Item
					disabled={ isPending }
					onClick={ () => updateMetadata( { starred: ! starred, archived } ) }
				>
					<Icon icon={ starred ? starFilled : starEmpty } size={ 16 } />
					{ starred ? __( 'Unstar conversation' ) : __( 'Star conversation' ) }
				</Menu.Item>
				<Menu.Item
					disabled={ isPending }
					onClick={ () => updateMetadata( { starred, archived: ! archived } ) }
				>
					<Icon icon={ box } size={ 16 } />
					{ archived ? __( 'Unarchive conversation' ) : __( 'Archive conversation' ) }
				</Menu.Item>
			</Menu.Popup>
		</Menu.Root>
	);
}

function SessionItem( { session, isVisible }: { session: AiSessionSummary; isVisible: boolean } ) {
	const label = session.firstPrompt?.trim();
	const isRunning = useIsSessionRunning( session.id );
	const hasPendingQuestion = useSessionHasPendingQuestion( session.id );

	return (
		<li className={ styles.sessionItem }>
			<SidebarButton
				className={ styles.sessionLink }
				render={
					<Link
						to="/sessions/$sessionId"
						params={ { sessionId: session.id } }
						tabIndex={ isVisible ? undefined : -1 }
						activeProps={ {
							className: clsx( styles.sessionLink, styles.sessionLinkActive ),
						} }
					/>
				}
			>
				{ hasPendingQuestion ? (
					<Tooltip.Root>
						<Tooltip.Trigger
							render={
								<span
									className={ styles.sessionQuestionIndicator }
									role="status"
									aria-label={ __( 'Studio needs an answer.' ) }
								/>
							}
						/>
						<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
							{ __( 'Studio needs an answer.' ) }
						</Tooltip.Popup>
					</Tooltip.Root>
				) : isRunning ? (
					<Spinner className={ styles.sessionInlineSpinner } label={ __( 'Working…' ) } />
				) : null }
				<span className={ clsx( styles.sessionLabel, ! label && styles.sessionLabelUntitled ) }>
					{ label || __( 'Untitled chat' ) }
				</span>
				<span className={ styles.sessionTime }>{ formatRelativeTime( session.updatedAt ) }</span>
			</SidebarButton>
			{ isVisible && ! isRunning ? (
				<div className={ styles.sessionActions }>
					<SessionActionsMenu session={ session } />
				</div>
			) : null }
		</li>
	);
}

function useNewSessionAction( site: SiteDetails ) {
	const navigate = useNavigate();
	const [ isPending, setIsPending ] = useState( false );
	const handleClick = async () => {
		setIsPending( true );
		try {
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} finally {
			setIsPending( false );
		}
	};

	return { isPending, handleClick };
}

function NewSessionButton( { site }: { site: SiteDetails } ) {
	const { isPending, handleClick } = useNewSessionAction( site );

	return (
		<IconButton
			variant="minimal"
			tone="neutral"
			size="small"
			icon={ plus }
			label={ __( 'New chat' ) }
			className={ styles.siteAction }
			loading={ isPending }
			loadingAnnouncement={ __( 'Creating chat' ) }
			onClick={ handleClick }
		/>
	);
}

function NewSessionTextButton( { site }: { site: SiteDetails } ) {
	const { isPending, handleClick } = useNewSessionAction( site );

	return (
		<Button
			variant="unstyled"
			tone="neutral"
			size="small"
			className={ styles.emptyChatButton }
			loading={ isPending }
			loadingAnnouncement={ __( 'Creating chat' ) }
			onClick={ handleClick }
		>
			{ __( 'New chat' ) }
		</Button>
	);
}

function DeleteSiteDialog( {
	site,
	open,
	onOpenChange,
}: {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const navigate = useNavigate();
	const params = useParams( { strict: false } ) as { siteId?: string };
	const deleteSite = useDeleteSite();
	const [ deleteFiles, setDeleteFiles ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );

	const handleConfirm = () => {
		setError( null );
		deleteSite.mutate(
			{ id: site.id, deleteFiles },
			{
				onSuccess: () => {
					onOpenChange( false );
					// If the user is currently viewing this site (settings or a
					// session that belongs to it), bounce them back to the root
					// so they don't land on a 404 once the cache refreshes.
					if ( params.siteId === site.id ) {
						void navigate( { to: '/' } );
					}
				},
				onError: ( err: Error ) => {
					setError( err.message ?? __( 'Unable to delete the site. Please try again.' ) );
				},
			}
		);
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! deleteSite.isPending ) {
					onOpenChange( next );
					if ( ! next ) {
						setError( null );
					}
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ sprintf( __( 'Delete %s' ), site.name ) }</Dialog.Title>
				</Dialog.Header>
				<p className={ styles.dialogText }>
					{ __(
						"The site's database will be lost, including all posts, pages, comments, and media."
					) }
				</p>
				<label className={ styles.dialogCheckbox }>
					<input
						type="checkbox"
						checked={ deleteFiles }
						onChange={ ( event ) => setDeleteFiles( event.target.checked ) }
					/>
					<span>{ __( 'Delete site files from my computer' ) }</span>
				</label>
				{ error ? <div className={ styles.dialogError }>{ error }</div> : null }
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ deleteSite.isPending }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ deleteSite.isPending }
						loadingAnnouncement={ __( 'Deleting site' ) }
						onClick={ handleConfirm }
					>
						{ __( 'Delete site' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}

function SiteActionsMenu( {
	site,
	isStarting,
	isStopping,
}: {
	site: SiteDetails;
	isStarting: boolean;
	isStopping: boolean;
} ) {
	const navigate = useNavigate();
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

	const handleOpenFolder = () => {
		void connector.openSiteFolder( site.id ).catch( ( error ) => {
			console.error( 'Failed to open site folder:', error );
		} );
	};

	const handleOpenInEditor = () => {
		// No editor preference yet — send the user to Settings so they can
		// pick one before the action becomes useful.
		if ( ! userPreferences?.editor ) {
			void navigate( { to: '/settings' } );
			return;
		}
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

	return (
		<>
			<Menu.Root modal={ false }>
				<Menu.Trigger
					render={
						<IconButton
							variant="minimal"
							tone="neutral"
							size="small"
							icon={ moreHorizontal }
							label={ __( 'Site actions' ) }
							className={ styles.siteAction }
						/>
					}
				/>
				<Menu.Popup side="bottom" align="end">
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
								to: '/sites/$siteId/settings',
								params: { siteId: site.id },
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
					<Menu.Item onClick={ handleOpenInEditor }>{ __( 'Open in editor' ) }</Menu.Item>
					<Menu.Item onClick={ handleOpenInTerminal }>{ __( 'Open in terminal' ) }</Menu.Item>
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
					<Menu.Item onClick={ () => setDeleteOpen( true ) }>{ __( 'Delete site' ) }</Menu.Item>
				</Menu.Popup>
			</Menu.Root>
			{ deleteOpen ? (
				<DeleteSiteDialog site={ site } open={ deleteOpen } onOpenChange={ setDeleteOpen } />
			) : null }
		</>
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
	const handleClick = () => {
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
						onClick={ busy ? undefined : handleClick }
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
							<svg
								className={ styles.siteStatusActionGlyph }
								viewBox="0 0 10 10"
								aria-hidden="true"
								focusable="false"
							>
								{ site.running ? (
									<rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
								) : (
									<path d="M2.5 1 L9 5 L2.5 9 Z" fill="currentColor" />
								) }
							</svg>
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
	group,
	isActive,
	isOpen,
	onToggle,
}: {
	group: SiteGroup;
	isActive: boolean;
	isOpen: boolean;
	onToggle: () => void;
} ) {
	const isStarting = useIsSiteStarting( group.site?.id );
	const isStopping = useIsSiteStopping( group.site?.id );
	const isStopped = !! group.site && ! group.site.running && ! isStarting;

	return (
		<section className={ clsx( styles.site, isActive && styles.siteActive ) }>
			<header className={ styles.siteHeader }>
				<div className={ styles.siteText }>
					<SidebarButton
						className={ styles.siteToggle }
						onClick={ onToggle }
						aria-expanded={ isOpen }
					>
						{ group.site ? (
							<span className={ styles.siteIconSlot } aria-hidden="true">
								<SiteIcon
									className={ clsx( styles.siteIcon, isStopped && styles.siteIconStopped ) }
									seed={ `${ group.site.id }:${ group.site.name }:${ group.site.path }` }
									imageSrc={ group.site.siteIcon }
								/>
							</span>
						) : null }
						<span className={ styles.siteName }>{ group.label }</span>
						<span className={ styles.siteChevron } aria-hidden="true">
							<Icon icon={ isOpen ? chevronDown : chevronRight } size={ 16 } />
						</span>
					</SidebarButton>
				</div>
				{ group.site ? (
					<div className={ styles.siteActions } data-reorder-exclude>
						<SiteActionsMenu
							site={ group.site }
							isStarting={ isStarting }
							isStopping={ isStopping }
						/>
						<NewSessionButton site={ group.site } />
						<SiteStatusButton
							site={ group.site }
							isStarting={ isStarting }
							isStopping={ isStopping }
						/>
					</div>
				) : null }
			</header>
			{ group.sessions.length > 0 || group.site ? (
				<div
					className={ clsx( styles.sessionListFrame, isOpen && styles.sessionListFrameOpen ) }
					aria-hidden={ ! isOpen }
					data-reorder-exclude
				>
					{ group.sessions.length > 0 ? (
						<ul className={ styles.sessionList }>
							{ group.sessions.map( ( session ) => (
								<SessionItem key={ session.id } session={ session } isVisible={ isOpen } />
							) ) }
						</ul>
					) : group.site ? (
						<div className={ styles.emptyChatState }>
							<span className={ styles.emptyChatText }>{ __( 'No active chats' ) }</span>
							<span className={ styles.emptyChatSeparator } aria-hidden="true">
								•
							</span>
							<NewSessionTextButton site={ group.site } />
						</div>
					) : null }
				</div>
			) : null }
		</section>
	);
}

function findActiveSiteKey(
	groups: SiteGroup[],
	activeSessionId: string | undefined,
	activeSiteId: string | undefined
): string | undefined {
	if ( activeSiteId ) {
		const match = groups.find( ( group ) => group.site?.id === activeSiteId );
		if ( match ) return match.key;
	}
	if ( ! activeSessionId ) {
		return undefined;
	}
	for ( const group of groups ) {
		if ( group.sessions.some( ( session ) => session.id === activeSessionId ) ) {
			return group.key;
		}
	}
	return undefined;
}

function getGroupKey( group: SiteGroup ) {
	return group.key;
}

export function SiteList() {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const activeSessionId = params.sessionId;
	const activeSiteId = params.siteId;
	const [ manualSiteOrder, setManualSiteOrder ] = useState< string[] >( [] );
	const updateSitesSortOrder = useUpdateSitesSortOrder();

	const orderedSites = useMemo(
		() => sortSitesByManualOrder( sortSites( [ ...( sites ?? [] ) ] ), manualSiteOrder ),
		[ sites, manualSiteOrder ]
	);
	const groups = useMemo(
		() => groupSessionsByOwner( orderedSites, sessions ),
		[ orderedSites, sessions ]
	);
	// Unassigned chats are intentionally not rendered; the grouping logic
	// itself goes away with the site-centric sidebar rework.
	const siteGroups = useMemo(
		() => groups.filter( ( group ) => group.key !== UNASSIGNED_KEY ),
		[ groups ]
	);
	const activeSiteKey = useMemo(
		() => findActiveSiteKey( siteGroups, activeSessionId, activeSiteId ),
		[ siteGroups, activeSessionId, activeSiteId ]
	);

	// Expansion is derived: by default the active site (or, if none, the
	// first site in the list) is open. Manual toggles are stored as
	// overrides so the user's explicit choice wins until they toggle again.
	const firstKey = siteGroups[ 0 ]?.key;
	const [ overrides, setOverrides ] = useState< Record< string, boolean > >( {} );

	const isOpen = ( key: string ): boolean => {
		if ( key in overrides ) {
			return overrides[ key ];
		}
		return key === activeSiteKey || ( ! activeSiteKey && key === firstKey );
	};

	const toggleSite = ( key: string ) => {
		setOverrides( ( prev ) => ( { ...prev, [ key ]: ! isOpen( key ) } ) );
	};

	const persistOrder = ( nextSiteIds: string[] ) => {
		setManualSiteOrder( nextSiteIds );
		updateSitesSortOrder.mutate( nextSiteIds );
	};

	const renderSiteGroup = ( group: SiteGroup ) => (
		<SiteSection
			group={ group }
			isActive={ group.key === activeSiteKey }
			isOpen={ isOpen( group.key ) }
			onToggle={ () => toggleSite( group.key ) }
		/>
	);

	return (
		<div className={ styles.root }>
			{ sitesLoading || sessionsLoading ? (
				<p className={ styles.empty }>{ __( 'Loading…' ) }</p>
			) : siteGroups.length === 0 ? (
				<p className={ styles.empty }>{ __( 'No sites yet' ) }</p>
			) : (
				<ReorderableList
					items={ siteGroups }
					getItemId={ getGroupKey }
					renderItem={ renderSiteGroup }
					onReorder={ persistOrder }
					className={ styles.sites }
					itemClassName={ styles.siteDragWrapper }
					placeholderClassName={ styles.siteDropPlaceholder }
					previewClassName={ styles.siteDragPreview }
					excludeSelector="[data-reorder-exclude]"
				/>
			) }
		</div>
	);
}
