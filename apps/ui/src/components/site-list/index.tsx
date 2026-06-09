import { Link, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
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
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@/components/menu';
import { SidebarButton } from '@/components/sidebar-button';
import { deriveSiteStatus } from '@/components/site-dropdown/utils';
import { SiteIcon } from '@/components/site-icon';
import { Spinner } from '@/components/spinner';
import { useIsSessionRunning, useSessionHasPendingQuestion } from '@/data/queries/use-agent-run';
import {
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionMetadata,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
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
} from '@/data/queries/use-sites';
import { formatRelativeTime } from '@/lib/format-relative-time';
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
		if ( ! session.ownerSitePath || ! knownSitePaths.has( session.ownerSitePath ) ) {
			if ( ! session.archived ) {
				unassigned.push( session );
			}
			continue;
		}

		const existing = sessionsByPath.get( session.ownerSitePath );
		if ( existing ) {
			existing.push( session );
		} else {
			sessionsByPath.set( session.ownerSitePath, [ session ] );
		}
	}

	const groups: SiteGroup[] = ( sites ?? [] ).map( ( site ) => ( {
		key: site.id,
		site,
		label: site.name,
		sessions: sessionsByPath.get( site.path ) ?? [],
	} ) );

	// Sort site-groups by the newest session's updatedAt so the most recently
	// used site lands at the top. Sites with no sessions drop to the bottom.
	groups.sort( ( a, b ) => {
		const aTimestamp = a.sessions[ 0 ]?.updatedAt;
		const bTimestamp = b.sessions[ 0 ]?.updatedAt;
		if ( ! aTimestamp && ! bTimestamp ) {
			return 0;
		}
		if ( ! aTimestamp ) {
			return 1;
		}
		if ( ! bTimestamp ) {
			return -1;
		}
		return Date.parse( bTimestamp ) - Date.parse( aTimestamp );
	} );

	if ( unassigned.length > 0 ) {
		groups.push( {
			key: UNASSIGNED_KEY,
			label: __( 'Unassigned' ),
			sessions: unassigned,
		} );
	}

	return groups;
}

function SessionActionsMenu( { session }: { session: AiSessionSummary } ) {
	const updateSessionMetadata = useUpdateSessionMetadata();
	const archiveSession = useArchiveSession();
	const unarchiveSession = useUnarchiveSession();
	const isPending =
		updateSessionMetadata.isPending || archiveSession.isPending || unarchiveSession.isPending;
	const starred = !! session.starred;
	const archived = !! session.archived;

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
					onClick={ () =>
						archived ? unarchiveSession.mutate( session ) : archiveSession.mutate( session )
					}
				>
					<Icon icon={ box } size={ 16 } />
					{ archived ? __( 'Unarchive conversation' ) : __( 'Archive conversation' ) }
				</Menu.Item>
			</Menu.Popup>
		</Menu.Root>
	);
}

function SessionItem( { session, isVisible }: { session: AiSessionSummary; isVisible: boolean } ) {
	const label = session.title?.trim() || session.firstPrompt?.trim();
	const isRunning = useIsSessionRunning( session.id );
	const hasPendingQuestion = useSessionHasPendingQuestion( session.id );
	const updateTitleDescription = useUpdateSessionTitleDescription();
	const params = useParams( { strict: false } ) as { sessionId?: string };
	const isActive = params.sessionId === session.id;
	const generatedTitle = session.generatedTitle ?? session.firstPrompt ?? '';
	const [ isEditing, setIsEditing ] = useState( false );
	const [ draftTitle, setDraftTitle ] = useState( session.userTitle ?? generatedTitle );
	const inputRef = useRef< HTMLInputElement | null >( null );
	const isSavingTitleRef = useRef( false );

	useEffect( () => {
		if ( ! isEditing ) {
			setDraftTitle( session.userTitle ?? generatedTitle );
		}
	}, [ generatedTitle, isEditing, session.userTitle ] );

	useEffect( () => {
		if ( isEditing ) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [ isEditing ] );

	const normalizeTitle = ( value: string ): string | undefined => {
		const normalized = value.trim();
		return normalized || undefined;
	};

	const getUserTitleOverride = (): string | undefined => {
		const normalized = normalizeTitle( draftTitle );
		if ( ! normalized ) {
			return undefined;
		}
		return normalized === normalizeTitle( generatedTitle ) ? undefined : normalized;
	};

	const startEditing = () => {
		if ( isRunning ) {
			return;
		}
		setDraftTitle( session.userTitle ?? generatedTitle );
		setIsEditing( true );
	};

	const saveTitle = async () => {
		if ( updateTitleDescription.isPending || isSavingTitleRef.current ) {
			return;
		}
		isSavingTitleRef.current = true;
		try {
			await updateTitleDescription.mutateAsync( {
				sessionId: session.id,
				title: getUserTitleOverride(),
			} );
			setIsEditing( false );
		} catch {
			inputRef.current?.focus();
		} finally {
			isSavingTitleRef.current = false;
		}
	};

	const cancelEditing = () => {
		setDraftTitle( session.userTitle ?? generatedTitle );
		setIsEditing( false );
	};

	if ( isEditing ) {
		return (
			<li className={ styles.sessionItem }>
				<form
					className={ clsx(
						styles.sessionLink,
						styles.sessionEditForm,
						isActive && styles.sessionLinkActive
					) }
					onSubmit={ ( event ) => {
						event.preventDefault();
						void saveTitle();
					} }
				>
					<input
						ref={ inputRef }
						className={ styles.sessionTitleInput }
						value={ draftTitle }
						aria-label={ __( 'Chat title' ) }
						placeholder={ __( 'Untitled chat' ) }
						disabled={ updateTitleDescription.isPending }
						onChange={ ( event ) => setDraftTitle( event.target.value ) }
						onBlur={ () => void saveTitle() }
						onKeyDown={ ( event ) => {
							if ( event.key === 'Escape' ) {
								event.preventDefault();
								cancelEditing();
							}
						} }
					/>
					{ updateTitleDescription.isPending ? (
						<Spinner className={ styles.sessionSpinner } label={ __( 'Saving…' ) } />
					) : null }
				</form>
			</li>
		);
	}

	return (
		<li className={ styles.sessionItem }>
			<SidebarButton
				className={ clsx( styles.sessionLink, isRunning && styles.sessionLinkRunning ) }
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
					<Tooltip.Provider delay={ 0 }>
						<Tooltip.Root>
							<Tooltip.Trigger
								render={
									<span
										className={ styles.sessionQuestionIndicator }
										role="status"
										aria-label={ __( 'Studio needs an answer.' ) }
									>
										?
									</span>
								}
							/>
							<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
								{ __( 'Studio needs an answer.' ) }
							</Tooltip.Popup>
						</Tooltip.Root>
					</Tooltip.Provider>
				) : isRunning ? (
					<Spinner className={ styles.sessionInlineSpinner } label={ __( 'Working…' ) } />
				) : null }
				<span className={ clsx( styles.sessionLabel, ! label && styles.sessionLabelUntitled ) }>
					<span
						className={ styles.sessionEditableTitle }
						onDoubleClick={ ( event ) => {
							event.preventDefault();
							event.stopPropagation();
							startEditing();
						} }
					>
						{ label || __( 'Untitled chat' ) }
					</span>
				</span>
				<span className={ styles.sessionTime }>{ formatRelativeTime( session.updatedAt ) }</span>
			</SidebarButton>
			{ ! isRunning ? (
				<div className={ styles.sessionActions }>
					<SessionActionsMenu session={ session } />
				</div>
			) : null }
		</li>
	);
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
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const busy = isStarting || isStopping;
	const isExporting = exportFullSite.isPending || exportDatabase.isPending;
	const [ deleteOpen, setDeleteOpen ] = useState( false );

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
						{ copySite.isPending ? __( 'Copying…' ) : __( 'Copy site' ) }
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
		<Tooltip.Provider delay={ 0 }>
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
								viewBox="0 0 8 8"
								aria-hidden="true"
								focusable="false"
							>
								<rect className={ styles.siteStatusShape } x="0" y="0" width="8" height="8" />
							</svg>
						</button>
					}
				/>
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
					{ tooltipLabel }
				</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}

function SiteSection( {
	group,
	isUnassigned,
	isActive,
	isOpen,
	onToggle,
	onSelect,
}: {
	group: SiteGroup;
	isUnassigned: boolean;
	isActive: boolean;
	isOpen: boolean;
	onToggle: () => void;
	onSelect: () => void;
} ) {
	const siteIconSeed = group.site
		? `${ group.site.id }:${ group.site.name }:${ group.site.path }`
		: group.key;
	const toggleLabel = isOpen ? __( 'Hide chats' ) : __( 'Show chats' );
	const activeSessions = useMemo(
		() => group.sessions.filter( ( session ) => ! session.archived ),
		[ group.sessions ]
	);
	const isStarting = useIsSiteStarting( group.site?.id );
	const isStopping = useIsSiteStopping( group.site?.id );
	const navigate = useNavigate();
	const selectGroup = () => {
		onSelect();
		void navigate( {
			to: group.site ? '/sites/$siteId' : '/unassigned',
			params: group.site ? { siteId: group.site.id } : undefined,
		} );
	};

	return (
		<section
			className={ clsx(
				styles.site,
				isUnassigned && styles.unassigned,
				isActive && styles.siteActive
			) }
		>
			<header className={ styles.siteHeader }>
				{ group.site || isUnassigned ? (
					<button
						type="button"
						className={ styles.siteRowButton }
						onClick={ selectGroup }
						aria-label={
							group.site
								? sprintf( __( 'View %s site details' ), group.label )
								: __( 'View unassigned chats' )
						}
					/>
				) : null }
				<div className={ styles.siteText }>
					<Tooltip.Provider delay={ 0 }>
						<Tooltip.Root>
							<Tooltip.Trigger
								render={
									<button
										type="button"
										className={ styles.siteIconToggle }
										onClick={ onToggle }
										aria-expanded={ isOpen }
										aria-label={ toggleLabel }
									>
										<span className={ styles.siteIconSlot } aria-hidden="true">
											<SiteIcon
												seed={ siteIconSeed }
												imageSrc={ group.site?.siteIcon }
												grayscale={ ! group.site }
												style={ { width: 24, height: 24 } }
											/>
										</span>
										<span className={ styles.siteIconChevron } aria-hidden="true">
											<Icon icon={ isOpen ? chevronDown : chevronRight } size={ 16 } />
										</span>
									</button>
								}
							/>
							<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
								{ toggleLabel }
							</Tooltip.Popup>
						</Tooltip.Root>
					</Tooltip.Provider>
					{ group.site ? (
						<span className={ styles.siteCopy }>
							<span className={ styles.siteName }>{ group.label }</span>
						</span>
					) : (
						<span className={ styles.siteCopy }>
							<span className={ styles.siteName }>{ group.label }</span>
						</span>
					) }
				</div>
				{ group.site ? (
					<div className={ styles.siteActions }>
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
			{ activeSessions.length > 0 ? (
				<div
					className={ clsx( styles.sessionListFrame, isOpen && styles.sessionListFrameOpen ) }
					aria-hidden={ ! isOpen }
				>
					{ isOpen ? (
						<ul className={ styles.sessionList }>
							{ activeSessions.map( ( session ) => (
								<SessionItem key={ session.id } session={ session } isVisible />
							) ) }
						</ul>
					) : null }
				</div>
			) : group.site && isOpen ? (
				<div className={ styles.emptyChatState }>
					<span className={ styles.emptyChatText }>{ __( 'No active chats' ) }</span>
					<span className={ styles.emptyChatSeparator } aria-hidden="true">
						•
					</span>
					<NewSessionTextButton site={ group.site } />
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

export function SiteList() {
	const { data: sites, isLoading: sitesLoading } = useSites();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const activeSessionId = params.sessionId;
	const activeSiteId = params.siteId;
	const isUnassignedRoute = pathname === '/unassigned';

	const groups = useMemo( () => groupSessionsByOwner( sites, sessions ), [ sites, sessions ] );
	const activeSiteKey = useMemo(
		() =>
			isUnassignedRoute
				? UNASSIGNED_KEY
				: findActiveSiteKey( groups, activeSessionId, activeSiteId ),
		[ groups, activeSessionId, activeSiteId, isUnassignedRoute ]
	);

	// Expansion is derived: by default only the active site/chat group is open.
	// Manual toggles are stored as overrides so the user's explicit choice wins
	// until they toggle again.
	const [ overrides, setOverrides ] = useState< Record< string, boolean > >( {} );

	const isDefaultOpen = ( key: string ): boolean => {
		return key === activeSiteKey;
	};

	const isOpen = ( key: string ): boolean => {
		if ( key in overrides ) {
			return overrides[ key ];
		}
		return isDefaultOpen( key );
	};

	const toggleSite = ( key: string ) => {
		setOverrides( ( prev ) => {
			if ( key in prev ) {
				const { [ key ]: _removed, ...next } = prev;
				return next;
			}
			return { ...prev, [ key ]: ! isDefaultOpen( key ) };
		} );
	};

	const clearSiteOverride = ( key: string ) => {
		setOverrides( ( prev ) => {
			if ( ! ( key in prev ) ) {
				return prev;
			}
			const { [ key ]: _removed, ...next } = prev;
			return next;
		} );
	};

	return (
		<div className={ styles.root }>
			{ sitesLoading || sessionsLoading ? (
				<p className={ styles.empty }>{ __( 'Loading…' ) }</p>
			) : groups.length === 0 ? (
				<p className={ styles.empty }>{ __( 'No sites yet' ) }</p>
			) : (
				<div className={ styles.sites }>
					{ groups.map( ( group ) => (
						<SiteSection
							key={ group.key }
							group={ group }
							isUnassigned={ group.key === UNASSIGNED_KEY }
							isActive={
								group.site ? !! activeSiteId && group.site.id === activeSiteId : isUnassignedRoute
							}
							isOpen={ isOpen( group.key ) }
							onToggle={ () => toggleSite( group.key ) }
							onSelect={ () => clearSiteOverride( group.key ) }
						/>
					) ) }
				</div>
			) }
		</div>
	);
}
