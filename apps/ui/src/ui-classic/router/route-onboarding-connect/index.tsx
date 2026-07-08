import { getEnvironmentLabel, getSiteEnvironment } from '@studio/common/lib/sync/environment-utils';
import { getMshotUrl } from '@studio/common/lib/sync/mshots';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { speak } from '@wordpress/a11y';
import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { chevronLeft, check, external, info, search } from '@wordpress/icons';
import { Button, Icon, IconButton, Input, InputLayout } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BusyOverlay } from '@/components/busy-overlay';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useFindAvailableSiteName } from '@/data/queries/use-create-site-helpers';
import { useCreateSite, useDeleteSite, useSites } from '@/data/queries/use-sites';
import { usePullSiteFromLive } from '@/data/queries/use-sync-site';
import { useUserLocale } from '@/data/queries/use-user-locale';
import {
	useAllConnectedWpcomSites,
	useSyncableWpcomSitesPage,
} from '@/data/queries/use-wpcom-sites';
import { useGridArrowNavigation } from '@/hooks/use-grid-arrow-navigation';
import { useOffline } from '@/hooks/use-offline';
import { getLocalizedLink } from '@/lib/docs-links';
import { onboardingLayoutRoute } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
// The external-link arrow on the auth buttons is shared with the welcome
// screen so the two auth prompts stay visually identical.
import welcomeStyles from '../route-welcome/style.module.css';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';

const SEARCH_VISIBILITY_THRESHOLD = 5;

// Same wordpress.com new-site flow the desktop renderer's Create button
// opens (see generate-checkout-url.ts).
const CREATE_WPCOM_SITE_URL =
	'https://wordpress.com/setup/new-hosted-site?ref=studio&section=studio-sync&showDomainStep=true';

// Labels for sites the user can see but not pick; the needs-upgrade and
// needs-transfer groups get overlay CTAs instead.
function getSyncStatusLabel( site: SyncSite ): string | null {
	switch ( site.syncSupport ) {
		case 'already-connected':
			return __( 'Already connected' );
		case 'missing-permissions':
			return __( 'Missing permissions' );
		case 'deleted':
			return __( 'Deleted' );
		case 'unsupported':
			return __( 'Unsupported' );
		default:
			return null;
	}
}

interface SiteSection {
	key: string;
	title?: string;
	description?: string;
	sites: SyncSite[];
}

// Groups sites the way the desktop renderer's picker does: syncable sites
// lead (no heading), followed by explained groups for everything else.
function groupSites( sites: SyncSite[] ): SiteSection[] {
	const syncable = sites.filter( ( s ) => s.syncSupport === 'syncable' );
	const alreadyConnected = sites.filter( ( s ) => s.syncSupport === 'already-connected' );
	const needsTransfer = sites.filter( ( s ) => s.syncSupport === 'needs-transfer' );
	const needsUpgrade = sites.filter( ( s ) => s.syncSupport === 'needs-upgrade' );
	const other = sites.filter(
		( s ) =>
			s.syncSupport === 'unsupported' ||
			s.syncSupport === 'missing-permissions' ||
			s.syncSupport === 'deleted'
	);

	const sections: SiteSection[] = [];
	if ( syncable.length > 0 ) {
		sections.push( { key: 'syncable', sites: syncable } );
	}
	if ( alreadyConnected.length > 0 ) {
		sections.push( {
			key: 'already-connected',
			title: __( 'Already connected' ),
			description: __( 'These sites are already linked to a local site.' ),
			sites: alreadyConnected,
		} );
	}
	if ( needsTransfer.length > 0 ) {
		sections.push( {
			key: 'needs-transfer',
			title: __( 'Enable hosting features first' ),
			description: __(
				'These sites need hosting features turned on before they can sync. You can do this from WordPress.com.'
			),
			sites: needsTransfer,
		} );
	}
	if ( needsUpgrade.length > 0 ) {
		sections.push( {
			key: 'needs-upgrade',
			title: __( 'Upgrade your plan to sync' ),
			description: __(
				'Syncing requires a Business plan or higher. Upgrade on WordPress.com to get started.'
			),
			sites: needsUpgrade,
		} );
	}
	if ( other.length > 0 ) {
		sections.push( {
			key: 'other',
			title: __( 'Not available for sync' ),
			description: __(
				"These sites can't be synced due to missing permissions or other limitations."
			),
			sites: other,
		} );
	}
	return sections;
}

function SignedOutView() {
	const connector = useConnector();
	const isOffline = useOffline();

	const benefits = [
		__( 'Work on your site locally.' ),
		__( 'Sync content, themes, and plugins.' ),
		__( 'Supports staging and production sites.' ),
	];

	return (
		<div className={ styles.signedOut }>
			<ul className={ styles.benefits }>
				{ benefits.map( ( benefit ) => (
					<li key={ benefit } className={ styles.benefit }>
						<Icon icon={ check } className={ styles.benefitIcon } />
						<span>{ benefit }</span>
					</li>
				) ) }
			</ul>
			<div className={ styles.authActions }>
				{ /* Same auth pair as the welcome screen so the two prompts
				     can't drift apart. */ }
				<div className={ styles.authButtons }>
					<Button
						type="button"
						variant="minimal"
						tone="neutral"
						disabled={ isOffline }
						onClick={ () => void connector.authenticate( true ) }
					>
						{ __( 'Sign up' ) }
						<span aria-hidden className={ welcomeStyles.arrow }>
							{ '↗' }
						</span>
					</Button>
					<Button
						type="button"
						variant="solid"
						tone="brand"
						disabled={ isOffline }
						onClick={ () => void connector.authenticate() }
					>
						{ __( 'Log in with WordPress.com' ) }
						<span aria-hidden className={ welcomeStyles.arrow }>
							{ '↗' }
						</span>
					</Button>
				</div>
				{ isOffline && (
					<p className={ styles.offlineHint }>{ __( "You're currently offline." ) }</p>
				) }
			</div>
		</div>
	);
}

// Centered call to action on a non-syncable site's thumbnail — "Enable" for
// sites that need hosting features, "Upgrade plan" for free-plan sites.
// Rendered as a sibling of the (inert) card button so the markup stays valid.
function ThumbnailCta( { site }: { site: SyncSite } ) {
	const connector = useConnector();

	if ( site.syncSupport === 'needs-upgrade' ) {
		return (
			<div className={ styles.thumbCtaOverlay }>
				<button
					type="button"
					className={ styles.ctaButton }
					onClick={ () =>
						void connector.openExternalUrl( `https://wordpress.com/plans/${ site.id }` )
					}
				>
					<span>{ __( 'Upgrade plan' ) }</span>
					<Icon icon={ external } size={ 14 } />
				</button>
				{ site.planName && <span className={ styles.planBadge }>{ site.planName }</span> }
			</div>
		);
	}
	if ( site.syncSupport === 'needs-transfer' ) {
		return (
			<div className={ styles.thumbCtaOverlay }>
				<button
					type="button"
					className={ styles.ctaButton }
					onClick={ () =>
						void connector.openExternalUrl( `https://wordpress.com/hosting-features/${ site.id }` )
					}
				>
					<span>{ __( 'Enable' ) }</span>
					<Icon icon={ external } size={ 14 } />
				</button>
			</div>
		);
	}
	return null;
}

function getConnectedSiteTooltip( localSiteNames: string[] ): string {
	const uniqueNames = [ ...new Set( localSiteNames.filter( Boolean ) ) ];

	if ( uniqueNames.length === 0 ) {
		return __( 'Already connected to another local site.' );
	}

	if ( uniqueNames.length === 1 ) {
		return sprintf(
			// translators: %s is a local Studio site name.
			__( 'Already connected to %s.' ),
			uniqueNames[ 0 ]
		);
	}

	return sprintf(
		// translators: 1: local Studio site name, 2: number of additional local Studio sites.
		__( 'Already connected to %1$s and %2$d more.' ),
		uniqueNames[ 0 ],
		uniqueNames.length - 1
	);
}

function ConnectedSiteInfo( { localSiteNames }: { localSiteNames: string[] } ) {
	const tooltipText = getConnectedSiteTooltip( localSiteNames );

	return (
		<div className={ styles.connectedInfoOverlay }>
			<IconButton
				variant="minimal"
				tone="neutral"
				size="small"
				icon={ info }
				label={ tooltipText }
				className={ styles.connectedInfoButton }
			/>
		</div>
	);
}

function RemoteSiteCard( {
	site,
	isSelected,
	onSelect,
	connectedLocalSiteNames,
}: {
	site: SyncSite;
	isSelected: boolean;
	onSelect: ( id: number ) => void;
	connectedLocalSiteNames?: string[];
} ) {
	const isSyncable = site.syncSupport === 'syncable';
	const isDimmed =
		site.syncSupport === 'deleted' ||
		site.syncSupport === 'unsupported' ||
		site.syncSupport === 'missing-permissions';
	const statusLabel = getSyncStatusLabel( site );
	const environment = getSiteEnvironment( site );

	let cardClass = styles.siteCard;
	if ( isSelected ) {
		cardClass += ` ${ styles.siteCardSelected }`;
	} else if ( ! isSyncable ) {
		cardClass += ` ${ styles.siteCardInert }`;
		if ( isDimmed ) {
			cardClass += ` ${ styles.siteCardDimmed }`;
		}
	}

	return (
		<li className={ styles.siteCardWrapper }>
			<button
				type="button"
				className={ cardClass }
				aria-pressed={ isSelected }
				aria-disabled={ ! isSyncable || undefined }
				data-arrow-nav-item
				onClick={ () => {
					if ( isSyncable ) {
						onSelect( site.id );
					}
				} }
			>
				<span className={ styles.siteThumb }>
					<img src={ getMshotUrl( site.url ) } alt="" loading="lazy" />
					{ isSyncable && (
						<span className={ styles.siteBadges }>
							<span className={ styles.siteBadge }>
								{ site.isPressable ? __( 'Pressable' ) : __( 'WP.com' ) }
							</span>
							<span className={ `${ styles.envBadge } ${ styles[ `envBadge-${ environment }` ] }` }>
								{ getEnvironmentLabel( environment ) }
							</span>
						</span>
					) }
				</span>
				<span className={ styles.siteText }>
					<span className={ styles.siteName }>{ site.name || site.url }</span>
					<span className={ styles.siteUrl }>{ site.url.replace( /^https?:\/\//, '' ) }</span>
					{ statusLabel && <span className={ styles.siteStatus }>{ statusLabel }</span> }
				</span>
			</button>
			<ThumbnailCta site={ site } />
			{ connectedLocalSiteNames && connectedLocalSiteNames.length > 0 && (
				<ConnectedSiteInfo localSiteNames={ connectedLocalSiteNames } />
			) }
		</li>
	);
}

export function OnboardingConnectPage() {
	const navigate = useNavigate();
	const connector = useConnector();
	const locale = useUserLocale();
	const { data: user, isLoading: isAuthLoading } = useAuthUser();
	const { data: localSites = [] } = useSites();
	const { data: connectedWpcomSites = [] } = useAllConnectedWpcomSites( { enabled: !! user } );
	const createSite = useCreateSite();
	const deleteSite = useDeleteSite();
	const pullSiteFromLive = usePullSiteFromLive();
	const findAvailableSiteName = useFindAvailableSiteName();

	const isOffline = useOffline();
	const handleGridKeyDown = useGridArrowNavigation();
	const [ selectedId, setSelectedId ] = useState< number | null >( null );
	const [ isConnecting, setIsConnecting ] = useState( false );
	const [ submitError, setSubmitError ] = useState( '' );
	const [ searchQuery, setSearchQuery ] = useState( '' );
	const [ debouncedSearchQuery, setDebouncedSearchQuery ] = useState( '' );
	const isSearching = searchQuery.trim().length > 0;
	const syncable = useSyncableWpcomSitesPage( {
		enabled: !! user,
		perPage: 100,
		search: debouncedSearchQuery,
	} );

	const sites = useMemo( () => syncable.data?.sites ?? [], [ syncable.data ] );
	const connectedLocalSiteNamesByRemoteId = useMemo( () => {
		const localSiteNamesById = new Map( localSites.map( ( site ) => [ site.id, site.name ] ) );
		const namesByRemoteId = new Map< number, string[] >();

		for ( const connectedSite of connectedWpcomSites ) {
			const localSiteName =
				localSiteNamesById.get( connectedSite.localSiteId ) ?? __( 'another local Studio site' );
			const names = namesByRemoteId.get( connectedSite.id ) ?? [];

			if ( ! names.includes( localSiteName ) ) {
				names.push( localSiteName );
			}

			namesByRemoteId.set( connectedSite.id, names );
		}

		return namesByRemoteId;
	}, [ connectedWpcomSites, localSites ] );
	const totalSites = syncable.data?.total ?? sites.length;
	const isSingleSite = ! isSearching && totalSites === 1 && sites.length === 1;
	const isLoadingSites = syncable.isLoading || ( syncable.isFetching && sites.length === 0 );

	useEffect( () => {
		const timer = window.setTimeout( () => {
			setDebouncedSearchQuery( searchQuery );
		}, 300 );
		return () => window.clearTimeout( timer );
	}, [ searchQuery ] );

	// With exactly one site on the account, pre-select it so the user can
	// proceed straight to Add site — mirrors the desktop renderer.
	useEffect( () => {
		if ( isSingleSite && sites[ 0 ].syncSupport === 'syncable' ) {
			setSelectedId( sites[ 0 ].id );
		}
	}, [ isSingleSite, sites ] );

	useEffect( () => {
		if ( selectedId && ! sites.some( ( site ) => site.id === selectedId ) ) {
			setSelectedId( null );
		}
	}, [ selectedId, sites ] );

	const sections = useMemo( () => groupSites( sites ), [ sites ] );
	const shouldGrowSection = useCallback(
		( section: SiteSection, sectionIndex: number ) => {
			if ( isSearching || section.key !== 'syncable' ) {
				return false;
			}
			return sections.length === 1 || ( sectionIndex === 0 && section.sites.length >= 3 );
		},
		[ isSearching, sections.length ]
	);
	const getSectionGridClass = useCallback(
		( section: SiteSection, sectionIndex: number ) => {
			if ( shouldGrowSection( section, sectionIndex ) ) {
				return `${ styles.siteGrid } ${ styles.siteGridPrimary }`;
			}

			if ( section.key === 'syncable' ) {
				return `${ styles.siteGrid } ${ styles.siteGridSecondary }`;
			}

			return `${ styles.siteGrid } ${ styles.siteGridCompact }`;
		},
		[ shouldGrowSection ]
	);

	const selectedSite = sites.find( ( site ) => site.id === selectedId );
	const showSearch = searchQuery.length > 0 || totalSites > SEARCH_VISIBILITY_THRESHOLD;

	const handleConnect = useCallback( async () => {
		if ( ! selectedSite || isConnecting ) {
			return;
		}
		setSubmitError( '' );
		setIsConnecting( true );
		let createdSiteId: string | null = null;
		try {
			// Create the local shell first (skipping server start — the pull
			// restarts it once the remote content lands), then persist the
			// connection and kick off the pull. Mirrors the desktop renderer's
			// pull-remote flow.
			const { name: availableName, path } = await findAvailableSiteName(
				selectedSite.name || selectedSite.url
			);
			const site = await createSite.mutateAsync( {
				name: availableName,
				path,
				skipStart: true,
			} );
			createdSiteId = site.id;
			await connector.connectWpcomSite( site.id, {
				...selectedSite,
				localSiteId: site.id,
				syncSupport: 'already-connected',
			} );
			// Fire-and-forget: the pull reports progress through the shared
			// sync-activity channel, which the site view surfaces.
			pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: selectedSite.id } );
			speak(
				sprintf(
					// translators: %s is the site name.
					__( '%s site added.' ),
					availableName
				)
			);
			await navigate( { to: '/sites/$siteId/new', params: { siteId: site.id } } );
		} catch ( error ) {
			// Roll back the never-connected shell so a retry doesn't leave an
			// orphaned local site behind (and pick "Name 2" next time around).
			if ( createdSiteId ) {
				try {
					await deleteSite.mutateAsync( { id: createdSiteId } );
				} catch {
					// Keep the original connect error as the user-facing message.
				}
			}
			setIsConnecting( false );
			setSubmitError(
				error instanceof Error ? error.message : __( 'Failed to connect site. Please try again.' )
			);
		}
	}, [
		selectedSite,
		isConnecting,
		findAvailableSiteName,
		connector,
		createSite,
		deleteSite,
		pullSiteFromLive,
		navigate,
	] );

	const isSignedIn = !! user;

	const helperLinks = (
		<p className={ styles.helperLinks }>
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				className={ styles.helperLink }
				onClick={ () => void syncable.refetch() }
				disabled={ syncable.isFetching }
			>
				{ syncable.isFetching ? __( 'Refreshing…' ) : __( 'Refresh list' ) }
			</Button>
			{ ' · ' }
			<Button
				type="button"
				variant="minimal"
				tone="neutral"
				className={ styles.helperLink }
				onClick={ () =>
					void connector.openExternalUrl( getLocalizedLink( locale, 'docsSyncSupportedSites' ) )
				}
			>
				<span>{ __( 'Supported sites' ) }</span>
				<Icon icon={ external } size={ 14 } />
			</Button>
		</p>
	);

	return (
		<div className={ `${ sharedStyles.page } ${ sharedStyles.pageSpacious }` }>
			{ /* Connecting creates the local site and persists the connection;
			     shield the window so stray clicks can't interrupt mid-flight. */ }
			<BusyOverlay active={ isConnecting } />
			<h1 className={ sharedStyles.title }>
				{ isSignedIn && isSingleSite ? __( 'Connect your site' ) : __( 'Connect a site' ) }
			</h1>
			<p className={ sharedStyles.subtitle }>
				{ ! isSignedIn && __( 'Log in with your WordPress.com account to see your sites.' ) }
				{ isSignedIn &&
					( isSingleSite
						? __( 'Ready to bring into your Studio.' )
						: __( 'Select a WordPress.com or Pressable site to bring into your Studio.' ) ) }
			</p>

			{ ! isSignedIn && ! isAuthLoading && <SignedOutView /> }

			{ isSignedIn && (
				<>
					{ /* The helper links read "Refreshing…" during the initial
					     load; hide the whole row until the list exists and let
					     the loading state below carry the message. */ }
					{ ! isSingleSite && ! isLoadingSites && (
						<div className={ styles.searchHeader }>
							{ showSearch && (
								<Input
									type="search"
									className={ styles.search }
									placeholder={ __( 'Search sites' ) }
									prefix={
										<InputLayout.Slot>
											<Icon icon={ search } size={ 16 } />
										</InputLayout.Slot>
									}
									value={ searchQuery }
									onChange={ ( event ) => setSearchQuery( event.target.value ) }
								/>
							) }
							{ helperLinks }
						</div>
					) }

					{ isLoadingSites && (
						<div className={ styles.loadingState }>
							<Spinner />
							<p className={ styles.listHint }>{ __( 'Loading your sites…' ) }</p>
						</div>
					) }
					{ ! isLoadingSites && ! isSearching && sites.length === 0 && (
						<div className={ styles.emptyState }>
							<p className={ styles.listHint }>
								{ __( 'No WordPress.com sites found on this account.' ) }
							</p>
							<Button
								type="button"
								variant="minimal"
								tone="brand"
								disabled={ isOffline }
								onClick={ () => void connector.openExternalUrl( CREATE_WPCOM_SITE_URL ) }
							>
								<span>{ __( 'Create a new WordPress.com site' ) }</span>
								<Icon icon={ external } size={ 14 } />
							</Button>
						</div>
					) }
					{ ! isLoadingSites && isSearching && sites.length === 0 && (
						<p className={ styles.listHint }>
							{ sprintf(
								// translators: %s is the search query.
								__( 'No sites found for "%s"' ),
								searchQuery
							) }
						</p>
					) }

					{ ! isLoadingSites && isSingleSite ? (
						<div className={ styles.singleSite }>
							<ul
								className={ `${ styles.siteGrid } ${ styles.siteGridSingle }` }
								onKeyDown={ handleGridKeyDown }
							>
								<RemoteSiteCard
									site={ sites[ 0 ] }
									isSelected={ selectedId === sites[ 0 ].id }
									onSelect={ setSelectedId }
									connectedLocalSiteNames={ connectedLocalSiteNamesByRemoteId.get( sites[ 0 ].id ) }
								/>
							</ul>
							{ helperLinks }
						</div>
					) : ! isLoadingSites && sites.length > 0 ? (
						<div className={ styles.sections }>
							{ sections.map( ( section, sectionIndex ) => (
								<section
									key={ section.key }
									className={ `${ styles.section } ${
										sectionIndex > 0 && sections[ sectionIndex - 1 ]?.key === 'syncable'
											? styles.sectionAfterAvailable
											: ''
									}` }
								>
									{ section.title && (
										<div className={ styles.sectionHeader }>
											<h3 className={ styles.sectionTitle }>{ section.title }</h3>
											{ section.description && (
												<p className={ styles.sectionDescription }>{ section.description }</p>
											) }
										</div>
									) }
									{ /* Grow the primary syncable row when it has enough sites to
										     read as a gallery. Grouped one- and two-card rows stay
										     compact and centered instead of ballooning. */ }
									<ul
										className={ getSectionGridClass( section, sectionIndex ) }
										onKeyDown={ handleGridKeyDown }
									>
										{ section.sites.map( ( site ) => (
											<RemoteSiteCard
												key={ site.id }
												site={ site }
												isSelected={ selectedId === site.id }
												onSelect={ setSelectedId }
												connectedLocalSiteNames={ connectedLocalSiteNamesByRemoteId.get( site.id ) }
											/>
										) ) }
									</ul>
								</section>
							) ) }
						</div>
					) : null }

					{ submitError && (
						<div role="alert" className={ styles.submitError }>
							{ submitError }
						</div>
					) }
				</>
			) }

			<OnboardingFooter>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					onClick={ () => void navigate( { to: '/onboarding' } ) }
					disabled={ isConnecting }
				>
					<Icon icon={ chevronLeft } size={ 16 } />
					<span>{ __( 'Back' ) }</span>
				</Button>
				{ isSignedIn && (
					<Button
						type="button"
						variant="solid"
						tone="brand"
						disabled={ ! selectedSite || isConnecting }
						loading={ isConnecting }
						loadingAnnouncement={ __( 'Connecting site' ) }
						onClick={ () => void handleConnect() }
						data-testid="connect-site-submit"
					>
						{ __( 'Connect site' ) }
					</Button>
				) }
			</OnboardingFooter>
		</div>
	);
}

export const onboardingConnectRoute = createRoute( {
	getParentRoute: () => onboardingLayoutRoute,
	path: '/onboarding/connect',
	component: OnboardingConnectPage,
} );
