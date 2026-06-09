import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { __, sprintf } from '@wordpress/i18n';
import { chevronDown, chevronRight, moreHorizontal, plus } from '@wordpress/icons';
import { Button, Dialog, Icon, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@/components/menu';
import { SidebarButton } from '@/components/sidebar-button';
import { SiteIcon } from '@/components/site-icon';
import { useSessions } from '@/data/queries/use-sessions';
import {
	useCopySite,
	useDeleteSite,
	useExportDatabase,
	useExportFullSite,
	useIsSiteStarting,
	useIsSiteStopping,
	useSiteSummaries,
	useStartSite,
	useStopSite,
} from '@/data/queries/use-sites';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './style.module.css';
import type { AiSessionSummary, SiteSummary } from '@/data/core';
import type { RefObject } from 'react';

const UNASSIGNED_KEY = '__unassigned__';
const SITE_ROW_HEIGHT = 32;
const SESSION_ROW_HEIGHT = 26;
const SESSION_LIST_MARGIN = 8;
const VIRTUAL_OVERSCAN = 12;

type SiteGroup = {
	key: string;
	site?: SiteSummary;
	label: string;
	sessions: AiSessionSummary[];
};

function groupSessionsByOwner(
	sites: SiteSummary[] | undefined,
	sessions: AiSessionSummary[] | undefined
): SiteGroup[] {
	if ( ! sessions?.length ) {
		return ( sites ?? [] ).map( ( site ) => ( {
			key: site.id,
			site,
			label: site.name,
			sessions: [],
		} ) );
	}

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

function SessionItem( { session, isVisible }: { session: AiSessionSummary; isVisible: boolean } ) {
	const label = session.firstPrompt?.trim() || __( '(No prompt yet)' );

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
				<span className={ styles.sessionLabel }>{ label }</span>
				<span className={ styles.sessionTime }>{ formatRelativeTime( session.updatedAt ) }</span>
			</SidebarButton>
		</li>
	);
}

function NewSessionButton( { site }: { site: SiteSummary } ) {
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
			label={ __( 'New session' ) }
			className={ styles.siteAction }
			loading={ isPending }
			loadingAnnouncement={ __( 'Creating session' ) }
			onClick={ handleClick }
		/>
	);
}

function DeleteSiteDialog( {
	site,
	open,
	onOpenChange,
}: {
	site: SiteSummary;
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

function SiteActionsMenu( { site }: { site: SiteSummary } ) {
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
}: {
	group: SiteGroup;
	isUnassigned: boolean;
	isActive: boolean;
	isOpen: boolean;
	onToggle: () => void;
} ) {
	return (
		<section
			className={ clsx(
				styles.site,
				isUnassigned && styles.unassigned,
				isActive && styles.siteActive
			) }
		>
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
					<div className={ styles.siteActions }>
						<SiteActionsMenu site={ group.site } />
						<NewSessionButton site={ group.site } />
					</div>
				) : null }
			</header>
			{ group.sessions.length > 0 ? (
				<div
					className={ clsx( styles.sessionListFrame, isOpen && styles.sessionListFrameOpen ) }
					aria-hidden={ ! isOpen }
				>
					<ul className={ styles.sessionList }>
						{ group.sessions.map( ( session ) => (
							<SessionItem key={ session.id } session={ session } isVisible={ isOpen } />
						) ) }
					</ul>
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

function getGroupHeight( group: SiteGroup, isOpen: boolean ): number {
	return (
		SITE_ROW_HEIGHT +
		( isOpen && group.sessions.length > 0
			? group.sessions.length * SESSION_ROW_HEIGHT + SESSION_LIST_MARGIN
			: 0 )
	);
}

function findStartIndex( offsets: number[], scrollTop: number ): number {
	let low = 0;
	let high = offsets.length - 1;
	while ( low < high ) {
		const mid = Math.floor( ( low + high ) / 2 );
		if ( offsets[ mid ] < scrollTop ) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return Math.max( 0, low - 1 );
}

function useSidebarViewport( rootRef: RefObject< HTMLDivElement | null > ) {
	const [ viewport, setViewport ] = useState( { scrollTop: 0, height: 0 } );

	useEffect( () => {
		const root = rootRef.current;
		const scroller = root?.parentElement;
		if ( ! root || ! scroller ) {
			return;
		}

		let frame = 0;
		const update = () => {
			cancelAnimationFrame( frame );
			frame = requestAnimationFrame( () => {
				setViewport( {
					scrollTop: Math.max( 0, scroller.scrollTop - root.offsetTop ),
					height: scroller.clientHeight,
				} );
			} );
		};

		update();
		scroller.addEventListener( 'scroll', update, { passive: true } );
		window.addEventListener( 'resize', update );
		return () => {
			cancelAnimationFrame( frame );
			scroller.removeEventListener( 'scroll', update );
			window.removeEventListener( 'resize', update );
		};
	}, [ rootRef ] );

	return viewport;
}

export function SiteList() {
	const rootRef = useRef< HTMLDivElement >( null );
	const { data: sites, isLoading: sitesLoading } = useSiteSummaries();
	const { data: sessions, isLoading: sessionsLoading } = useSessions();
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const activeSessionId = params.sessionId;
	const activeSiteId = params.siteId;

	const groups = useMemo( () => groupSessionsByOwner( sites, sessions ), [ sites, sessions ] );
	const activeSiteKey = useMemo(
		() => findActiveSiteKey( groups, activeSessionId, activeSiteId ),
		[ groups, activeSessionId, activeSiteId ]
	);

	// Expansion is derived: by default the active site (or, if none, the
	// MRU site — first in the list) is open. Manual toggles are stored as
	// overrides so the user's explicit choice wins until they toggle again.
	const mruKey = groups[ 0 ]?.key;
	const [ overrides, setOverrides ] = useState< Record< string, boolean > >( {} );

	const isOpen = ( key: string ): boolean => {
		if ( key in overrides ) {
			return overrides[ key ];
		}
		return key === activeSiteKey || ( ! activeSiteKey && key === mruKey );
	};

	const toggleSite = ( key: string ) => {
		setOverrides( ( prev ) => ( { ...prev, [ key ]: ! isOpen( key ) } ) );
	};
	const viewport = useSidebarViewport( rootRef );
	const virtualLayout = useMemo( () => {
		const offsets: number[] = [];
		const heights: number[] = [];
		let totalHeight = 0;
		for ( const group of groups ) {
			offsets.push( totalHeight );
			const height = getGroupHeight( group, isOpen( group.key ) );
			heights.push( height );
			totalHeight += height;
		}
		return { offsets, heights, totalHeight };
		// `isOpen` is derived from groups, activeSiteKey, mruKey, and overrides.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ groups, activeSiteKey, mruKey, overrides ] );
	const visibleGroups = useMemo( () => {
		if ( groups.length === 0 ) {
			return [];
		}
		const start = Math.max(
			0,
			findStartIndex( virtualLayout.offsets, viewport.scrollTop ) - VIRTUAL_OVERSCAN
		);
		const endBoundary = viewport.scrollTop + viewport.height;
		let end = start;
		while (
			end < groups.length - 1 &&
			virtualLayout.offsets[ end ] + virtualLayout.heights[ end ] < endBoundary
		) {
			end++;
		}
		end = Math.min( groups.length - 1, end + VIRTUAL_OVERSCAN );
		return groups.slice( start, end + 1 ).map( ( group, index ) => ( {
			group,
			index: start + index,
		} ) );
	}, [ groups, virtualLayout, viewport ] );

	return (
		<div ref={ rootRef } className={ styles.root }>
			{ sitesLoading || sessionsLoading ? (
				<p className={ styles.empty }>{ __( 'Loading…' ) }</p>
			) : groups.length === 0 ? (
				<p className={ styles.empty }>{ __( 'No sites yet' ) }</p>
			) : (
				<div className={ styles.sitesVirtual } style={ { height: virtualLayout.totalHeight } }>
					{ visibleGroups.map( ( { group, index } ) => (
						<div
							key={ group.key }
							className={ styles.siteVirtualRow }
							style={ { transform: `translateY(${ virtualLayout.offsets[ index ] }px)` } }
						>
							<SiteSection
								group={ group }
								isUnassigned={ group.key === UNASSIGNED_KEY }
								isActive={ group.key === activeSiteKey }
								isOpen={ isOpen( group.key ) }
								onToggle={ () => toggleSite( group.key ) }
							/>
						</div>
					) ) }
				</div>
			) }
		</div>
	);
}
