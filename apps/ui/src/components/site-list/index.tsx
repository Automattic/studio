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

function SiteActionsMenu( { site }: { site: SiteDetails } ) {
	const navigate = useNavigate();
	const startSite = useStartSite();
	const stopSite = useStopSite();
	const copySite = useCopySite();
	const exportFullSite = useExportFullSite();
	const exportDatabase = useExportDatabase();
	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
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
			<DeleteSiteDialog site={ site } open={ deleteOpen } onOpenChange={ setDeleteOpen } />
		</>
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
	const activeSessions = group.sessions.filter( ( session ) => ! session.archived );
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
						<NewSessionButton site={ group.site } />
						<SiteActionsMenu site={ group.site } />
					</div>
				) : null }
			</header>
			{ activeSessions.length > 0 ? (
				<div
					className={ clsx( styles.sessionListFrame, isOpen && styles.sessionListFrameOpen ) }
					aria-hidden={ ! isOpen }
				>
					<ul className={ styles.sessionList }>
						{ activeSessions.map( ( session ) => (
							<SessionItem key={ session.id } session={ session } isVisible={ isOpen } />
						) ) }
					</ul>
				</div>
			) : group.site && isOpen ? (
				<p className={ styles.emptyChatState }>
					<span className={ styles.emptyChatText }>{ __( 'Create a chat' ) }</span>
					<span className={ styles.emptyChatPointer } aria-hidden="true">
						<svg viewBox="0 0 84 76" focusable="false">
							<path
								fillRule="evenodd"
								clipRule="evenodd"
								d="M1.76001 75.17C0.809995 74.96 0.280012 73.88 0.520017 72.99C0.780012 72.03 1.74 71.56 2.68001 71.75H2.69002C2.67001 71.75 2.66 71.74 2.65001 71.74H2.80002C2.89171 71.7286 2.98343 71.7138 3.07701 71.6958C3.23132 71.6572 3.38568 71.6182 3.54001 71.57C4.02 71.39 4.49 71.18 4.95001 70.95C6.66958 70.0682 8.2803 69.0075 9.89187 67.9462C10.1078 67.804 10.3238 67.6618 10.54 67.52C10.8151 67.3285 11.0903 67.1374 11.3653 66.9464C12.5695 66.1098 13.7715 65.2747 14.96 64.42C15.86 63.77 16.76 63.12 17.67 62.47C18.1966 62.09 18.7055 61.6923 19.2144 61.2945C19.4688 61.0956 19.7233 60.8967 19.98 60.7C21.57 59.48 23.13 58.24 24.69 56.98L24.9572 56.7685C25.4501 56.3786 25.9458 55.9864 26.42 55.58C26.8743 55.1856 27.326 54.7913 27.7778 54.397C28.231 54.0013 28.6843 53.6057 29.14 53.21C29.6868 52.7281 30.2422 52.2462 30.7903 51.7722C31.2079 51.3798 31.6246 50.9874 32.0409 50.5954C32.9268 49.7611 33.8111 48.9283 34.7 48.1C35.5072 47.339 36.2789 46.5543 37.0515 45.7687L37.058 45.762C37.2883 45.5279 37.5186 45.2937 37.75 45.06C37.9835 44.8218 38.2181 44.5847 38.4526 44.3477L38.4577 44.3426C39.2259 43.5663 39.9934 42.7907 40.72 41.98C41.91 40.65 43.1 39.33 44.29 38.01C44.9394 37.2107 45.5913 36.4114 46.2433 35.6122C46.8964 34.8115 47.5494 34.0107 48.2 33.21C48.59 32.7327 48.9482 32.2237 49.3053 31.7165C49.4793 31.4693 49.653 31.2225 49.83 30.98C49.9279 30.8456 50.0261 30.7116 50.1247 30.5779C50.2312 30.4333 50.338 30.2889 50.4448 30.1446L50.4456 30.1435C50.9156 29.5083 51.3849 28.8738 51.83 28.22V28.24C53.37 25.96 54.78 23.62 56.03 21.17C56.91 19.39 57.67 17.56 58.34 15.7C58.96 13.91 59.45 12.11 59.93 10.28C60.151 9.44028 60.3251 8.60055 60.5007 7.75392L60.57 7.42L60.5852 7.31476L60.5855 7.31259C60.7003 6.5192 60.8139 5.73419 60.9 4.94001C60.261 5.40915 59.6416 5.91753 59.026 6.42285C58.8805 6.54226 58.7353 6.6615 58.59 6.78C57.83 7.41 57.07 8.03 56.29 8.64C56.1778 8.7287 56.0657 8.8175 55.9535 8.90638L55.6428 9.15285C54.3795 10.155 53.1139 11.159 51.79 12.09L50.17 13.23C50.0875 13.2878 50.0057 13.3471 49.9238 13.4064C49.7082 13.5627 49.4919 13.7196 49.26 13.85C49.1133 13.938 48.9669 14.026 48.8207 14.114C48.494 14.3106 48.1681 14.5071 47.8422 14.7037C47.369 14.9891 46.8957 15.2746 46.42 15.56C46.2175 15.68 45.9981 15.7831 45.7787 15.8863C45.7056 15.9206 45.6325 15.955 45.56 15.99C45.2403 16.1499 44.923 16.3098 44.6057 16.4696L44.6 16.4725C44.2841 16.6317 43.9683 16.7908 43.65 16.95C42.892 17.3337 42.1078 17.6736 41.3301 18.0106L41.17 18.08C38.57 19.22 35.92 20.3 33.21 21.13C30.41 21.98 27.53 22.35 24.63 22.64C23.67 22.73 22.77 22.11 22.63 21.12C22.51 20.19 23.18 19.22 24.15 19.13C24.99 19.04 25.83 18.95 26.67 18.85C27.6 18.73 28.53 18.58 29.45 18.42C31.05 18.08 32.61 17.63 34.16 17.09C34.1533 17.0929 34.1466 17.0956 34.1397 17.0983C34.1351 17.1001 34.1305 17.1019 34.1259 17.1037C36.4823 16.2579 38.7679 15.2617 41.0629 14.2614L41.64 14.01C41.605 14.03 41.57 14.0475 41.535 14.065C41.5 14.0825 41.465 14.1 41.43 14.12C41.9546 13.8552 42.4817 13.5904 43.0088 13.3256C43.5367 13.0604 44.0646 12.7952 44.59 12.53C44.9151 12.3643 45.228 12.1661 45.539 11.969C45.716 11.8569 45.8923 11.7452 46.07 11.64C46.54 11.35 47.01 11.07 47.48 10.79C47.898 10.4964 48.3134 10.2028 48.7289 9.90928L48.7343 9.90548C49.152 9.61032 49.5698 9.31516 49.99 9.02C50.5461 8.62376 51.0829 8.20337 51.6205 7.78232C51.8563 7.59768 52.0922 7.41292 52.33 7.23001C53.7891 6.11369 55.2194 4.93982 56.6396 3.77417L56.6406 3.77344L56.73 3.7C56.8438 3.60573 56.9576 3.51081 57.0717 3.41569C57.9496 2.68341 58.8411 1.93989 59.85 1.40001C60.58 1.00001 61.57 0.710005 62.4 0.990003C62.4245 0.998182 62.449 1.00644 62.4734 1.01482C62.8621 0.965185 63.2588 1.04024 63.6 1.24C64.01 1.48 64.26 1.85 64.41 2.3C64.4818 2.50876 64.528 2.72603 64.5737 2.94071C64.598 3.0551 64.6222 3.16876 64.65 3.28C64.72 3.57 64.78 3.85 64.84 4.14C64.9169 4.48812 64.9917 4.83624 65.0663 5.18344C65.1567 5.6042 65.2469 6.0236 65.34 6.44L65.3843 6.63504C65.9892 9.29953 66.5917 11.9531 67.48 14.54C67.4597 14.4927 67.444 14.4454 67.4267 14.3982C67.4184 14.3754 67.4097 14.3527 67.4 14.33C68.04 16.15 68.79 17.92 69.65 19.64C70.62 21.55 71.66 23.42 72.85 25.21C73.6 26.32 74.41 27.37 75.29 28.39C75.72 28.87 76.17 29.33 76.64 29.77C77.4434 30.4706 78.2816 31.1275 79.1547 31.7327C79.1532 31.7318 79.1516 31.7309 79.15 31.73C79.1581 31.7354 79.166 31.7407 79.174 31.7461C79.2292 31.7843 79.2845 31.8222 79.34 31.86C79.318 31.8453 79.296 31.8293 79.2735 31.8129C79.2715 31.8115 79.2694 31.81 79.2674 31.8085C80.2296 32.4507 81.2097 33.0753 82.1896 33.6998C83.0096 34.2098 83.33 35.27 82.83 36.12C82.51 36.67 81.89 37 81.27 37C80.97 36.99 80.67 36.91 80.4 36.75C79.54 36.21 78.69 35.67 77.85 35.11C75.9 33.81 74.07 32.39 72.53 30.61C70.98 28.82 69.64 26.88 68.44 24.84C67.17 22.68 66.03 20.42 65.06 18.11C64.2542 16.1832 63.6096 14.195 63.0655 12.179C63.0181 12.3522 62.9706 12.5256 62.9239 12.6995C62.9024 12.7796 62.8811 12.8597 62.86 12.94C62.34 14.9 61.69 16.83 60.95 18.72C59.97 21.24 58.75 23.65 57.4 25.99C56.42 27.7 55.35 29.39 54.19 30.98C53.9655 31.2873 53.7409 31.5955 53.5161 31.904C52.98 32.6396 52.4425 33.3773 51.9 34.11C51.8177 34.2226 51.736 34.3355 51.6542 34.4486L51.6524 34.451L51.6516 34.4522C51.3563 34.8604 51.0603 35.2693 50.74 35.66C50.3406 36.1542 49.9387 36.646 49.5368 37.1377L49.5335 37.1418C49.1315 37.6337 48.7295 38.1256 48.33 38.62C48.2776 38.685 48.2253 38.7502 48.173 38.8155C48.1031 38.903 48.0332 38.9908 47.9633 39.0786C47.5873 39.5508 47.21 40.0246 46.81 40.47C45.8398 41.542 44.8742 42.6185 43.9101 43.6935C43.4532 44.2029 42.9966 44.712 42.54 45.22C42.169 45.6274 41.7716 46.0188 41.3746 46.4098C41.2259 46.5563 41.0772 46.7028 40.93 46.85C40.48 47.305 40.03 47.7625 39.58 48.22C39.13 48.6775 38.68 49.135 38.23 49.59C37.2684 50.5585 36.268 51.4882 35.2694 52.4163C34.8348 52.8202 34.4006 53.2237 33.97 53.63C32.8844 54.6544 31.7521 55.6321 30.6222 56.6076C30.2741 56.9082 29.9262 57.2085 29.58 57.51C26.7833 59.9465 23.8427 62.2032 20.9033 64.4591L20.42 64.83C19.3786 65.6328 18.311 66.3937 17.2437 67.1544C16.8353 67.4455 16.4269 67.7366 16.02 68.03C14.5 69.12 12.96 70.17 11.4 71.2C11.2446 71.3013 11.0894 71.4028 10.9343 71.5042C9.97105 72.134 9.00906 72.763 8.01001 73.34C6.98001 73.94 5.90001 74.5 4.78001 74.9C4.08 75.15 3.39001 75.3 2.69002 75.3L2.60632 75.2911C2.34709 75.2637 2.05745 75.2331 1.76001 75.17ZM79.2674 31.8085C79.2318 31.7826 79.1949 31.7561 79.1547 31.7327C79.1612 31.7372 79.1676 31.7416 79.174 31.7461C79.205 31.7669 79.2363 31.7877 79.2674 31.8085ZM3.23123 71.6635C3.17912 71.6752 3.12771 71.686 3.07701 71.6958C3.10875 71.6882 3.13923 71.6821 3.16949 71.6761L3.19229 71.6716C3.20518 71.669 3.21812 71.6663 3.23123 71.6635ZM34.0499 17.13C34.0633 17.1256 34.0768 17.1211 34.0901 17.1165L33.94 17.17C33.975 17.155 34.0124 17.1425 34.0499 17.13ZM51.85 28.2C51.85 28.205 51.8475 28.2075 51.845 28.21C51.8425 28.2125 51.84 28.215 51.84 28.22C51.84 28.21 51.85 28.2 51.85 28.2Z"
							/>
						</svg>
					</span>
				</p>
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
	const isAllSitesRoute = pathname === '/sites';

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
		if ( isAllSitesRoute ) {
			return false;
		}
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
