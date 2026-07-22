import { createRoute, useNavigate } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { chevronLeft, external, search, wordpress } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useCreateSite, useDeleteSite, useSites, useStartSite } from '@/data/queries/use-sites';
import { usePullSiteFromLive } from '@/data/queries/use-sync-site';
import { useAllConnectedWpcomSites, useAllWpcomSites } from '@/data/queries/use-wpcom-sites';
import { reportSyncError } from '@/data/sync-activity';
import { useOffline } from '@/hooks/use-offline';
import { onboardingLayoutRoute, useOnboardingProgress } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import {
	ConnectSiteLifecycleError,
	findAvailableSitePath,
	runConnectSiteLifecycle,
} from './connect-site';
import { presentRemoteSites, searchRemoteSites, type ConnectSiteGroup } from './site-presentation';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';

const CREATE_WPCOM_SITE_URL =
	'https://wordpress.com/setup/new-hosted-site?ref=studio&section=studio-sync&showDomainStep=true';
const MSHOTS_REFRESH_DELAY_MS = 5_000;
const MSHOTS_MAX_REFRESHES = 5;

interface SiteSection {
	key: ConnectSiteGroup;
	title: string;
	description: string;
}

function getSiteEnvironment( site: SyncSite ): 'production' | 'staging' | 'development' {
	if ( site.isPressable && site.environmentType === 'development' ) return 'development';
	if ( site.isPressable && site.environmentType === 'staging' ) return 'staging';
	return site.isStaging ? 'staging' : 'production';
}

function getEnvironmentLabel( environment: ReturnType< typeof getSiteEnvironment > ): string {
	if ( environment === 'staging' ) return __( 'Staging' );
	if ( environment === 'development' ) return __( 'Development' );
	return __( 'Production' );
}

function getSiteStatus( site: SyncSite, group: ConnectSiteGroup, localNames: string[] ): string {
	if ( group === 'connected' ) {
		if ( localNames.length === 0 ) return __( 'Already connected to a local Studio site.' );
		return sprintf(
			// translators: %s is a comma-separated list of local Studio site names.
			__( 'Connected to: %s' ),
			localNames.join( ', ' )
		);
	}
	if ( group === 'needs-transfer' ) {
		return __( 'Enable hosting features on WordPress.com before connecting this site.' );
	}
	if ( group === 'needs-upgrade' ) {
		return __( 'Upgrade this site to a supported plan before connecting it.' );
	}
	if ( site.syncSupport === 'missing-permissions' ) {
		return __( "Your account doesn't have permission to manage this site." );
	}
	if ( site.syncSupport === 'deleted' ) return __( 'This site has been deleted.' );
	return __( 'This site does not support pulling into Studio.' );
}

function getSiteName( site: SyncSite ): string {
	if ( site.name.trim() ) return site.name.trim();
	try {
		return new URL( site.url ).hostname;
	} catch {
		return __( 'WordPress site' );
	}
}

export function RemoteSiteThumbnail( { siteUrl }: { siteUrl: string } ) {
	const [ refresh, setRefresh ] = useState( 0 );
	const refreshTimer = useRef< ReturnType< typeof setTimeout > | undefined >( undefined );

	useEffect(
		() => () => {
			if ( refreshTimer.current ) {
				clearTimeout( refreshTimer.current );
			}
		},
		[]
	);

	const scheduleRefresh = useCallback( () => {
		if ( refresh >= MSHOTS_MAX_REFRESHES ) return;
		if ( refreshTimer.current ) clearTimeout( refreshTimer.current );
		refreshTimer.current = setTimeout( () => {
			setRefresh( ( current ) => current + 1 );
		}, MSHOTS_REFRESH_DELAY_MS );
	}, [ refresh ] );

	return (
		<img
			src={ `https://s0.wp.com/mshots/v1/${ encodeURIComponent(
				siteUrl
			) }?w=600&h=400&studio_refresh=${ refresh }` }
			alt=""
			loading="lazy"
			onLoad={ scheduleRefresh }
		/>
	);
}

function RemoteSiteCard( {
	site,
	group,
	connectedLocalSiteNames,
	isSelected,
	onSelect,
}: ReturnType< typeof presentRemoteSites >[ number ] & {
	isSelected: boolean;
	onSelect: ( id: number ) => void;
} ) {
	const connector = useConnector();
	const environment = getSiteEnvironment( site );
	const isAvailable = group === 'available';
	const siteStatus = isAvailable ? '' : getSiteStatus( site, group, connectedLocalSiteNames );
	const className = [
		styles.siteCard,
		isSelected ? styles.siteCardSelected : '',
		! isAvailable ? styles.siteCardUnavailable : '',
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<li className={ styles.siteCardWrapper }>
			<button
				type="button"
				className={ className }
				aria-pressed={ isAvailable ? isSelected : undefined }
				aria-disabled={ ! isAvailable || undefined }
				onClick={ () => isAvailable && onSelect( site.id ) }
			>
				<span className={ styles.siteThumb }>
					<RemoteSiteThumbnail siteUrl={ site.url } />
				</span>
				<span className={ styles.siteText }>
					<span className={ styles.siteName }>{ getSiteName( site ) }</span>
					<span className={ styles.siteUrl }>{ site.url.replace( /^https?:\/\//, '' ) }</span>
					<span className={ styles.badges }>
						<span className={ styles.badge }>
							{ site.isPressable ? __( 'Pressable' ) : __( 'WordPress.com' ) }
						</span>
						<span className={ styles.badge }>{ getEnvironmentLabel( environment ) }</span>
					</span>
					{ siteStatus && <span className={ styles.siteStatus }>{ siteStatus }</span> }
				</span>
			</button>
			{ group === 'needs-transfer' && (
				<Button
					type="button"
					variant="minimal"
					tone="brand"
					className={ styles.siteAction }
					onClick={ () =>
						void connector.openExternalUrl( `https://wordpress.com/hosting-features/${ site.id }` )
					}
				>
					<span>{ __( 'Enable hosting features' ) }</span>
					<Icon icon={ external } size={ 14 } />
				</Button>
			) }
			{ group === 'needs-upgrade' && (
				<Button
					type="button"
					variant="minimal"
					tone="brand"
					className={ styles.siteAction }
					onClick={ () =>
						void connector.openExternalUrl( `https://wordpress.com/plans/${ site.id }` )
					}
				>
					<span>{ __( 'View plans' ) }</span>
					<Icon icon={ external } size={ 14 } />
				</Button>
			) }
		</li>
	);
}

function SignedOutView() {
	const isOffline = useOffline();
	const login = useLogin();
	const signup = useLogin( { signup: true } );
	const authError = login.error ?? signup.error;

	return (
		<div className={ styles.signedOut }>
			<ul className={ styles.benefits }>
				<li>{ __( 'Pull content, themes, plugins, and media into a local site.' ) }</li>
				<li>{ __( 'Connect WordPress.com and Pressable production or staging sites.' ) }</li>
				<li>{ __( 'Keep the local and live relationship available for future syncs.' ) }</li>
			</ul>
			<div className={ styles.authActions }>
				<Button
					type="button"
					variant="solid"
					tone="brand"
					disabled={ isOffline || signup.isPending }
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					<Icon icon={ wordpress } />
					<span>{ __( 'Log in with WordPress.com' ) }</span>
				</Button>
				<Button
					type="button"
					variant="outline"
					tone="neutral"
					disabled={ isOffline || login.isPending }
					loading={ signup.isPending }
					onClick={ () => signup.mutate() }
				>
					{ __( 'Create a free account' ) }
				</Button>
			</div>
			{ isOffline && (
				<p className={ styles.hint }>{ __( "You're offline. Reconnect to sign in." ) }</p>
			) }
			{ authError && (
				<p role="alert" className={ styles.error }>
					{ authError instanceof Error
						? authError.message
						: __( 'Authentication failed. Please try again.' ) }
				</p>
			) }
		</div>
	);
}

export function OnboardingConnectPage() {
	const connector = useConnector();
	const navigate = useNavigate();
	const { setProgress } = useOnboardingProgress();
	const { data: user, isLoading: isAuthLoading } = useAuthUser();
	const { data: localSites = [] } = useSites();
	const isOffline = useOffline();
	const remoteSites = useAllWpcomSites( { enabled: !! user && ! isOffline } );
	const connections = useAllConnectedWpcomSites( { enabled: !! user && ! isOffline } );
	const createSite = useCreateSite();
	const deleteSite = useDeleteSite();
	const pullSite = usePullSiteFromLive();
	const startSite = useStartSite();
	const [ searchQuery, setSearchQuery ] = useState( '' );
	const [ selectedId, setSelectedId ] = useState< number | null >( null );
	const [ isConnecting, setIsConnecting ] = useState( false );
	const [ submitError, setSubmitError ] = useState( '' );

	const presentedSites = useMemo(
		() => presentRemoteSites( remoteSites.data ?? [], connections.data ?? [], localSites ),
		[ remoteSites.data, connections.data, localSites ]
	);
	const filteredSites = useMemo(
		() => searchRemoteSites( presentedSites, searchQuery ),
		[ presentedSites, searchQuery ]
	);
	const isSingleSite = presentedSites.length === 1 && searchQuery.trim() === '';
	const selectedSite = filteredSites.find(
		( entry ) => entry.site.id === selectedId && entry.group === 'available'
	)?.site;
	const isLoadingSites =
		remoteSites.isLoading ||
		connections.isLoading ||
		( remoteSites.isFetching && ! remoteSites.data ) ||
		( connections.isFetching && ! connections.data );
	const loadError = remoteSites.error ?? connections.error;

	const sections = useMemo< SiteSection[] >(
		() => [
			{
				key: 'available',
				title: __( 'Available to connect' ),
				description: __( 'Select a site to create its local copy.' ),
			},
			{
				key: 'connected',
				title: __( 'Already connected' ),
				description: __( 'These sites already have a local Studio connection.' ),
			},
			{
				key: 'needs-transfer',
				title: __( 'Hosting features required' ),
				description: __( 'Enable hosting features on WordPress.com before connecting.' ),
			},
			{
				key: 'needs-upgrade',
				title: __( 'Plan upgrade required' ),
				description: __( 'These sites need a supported plan before they can sync.' ),
			},
			{
				key: 'unavailable',
				title: __( 'Unavailable' ),
				description: __( 'These sites cannot be pulled into Studio.' ),
			},
		],
		[]
	);

	useEffect( () => {
		if ( isSingleSite && presentedSites[ 0 ]?.group === 'available' ) {
			setSelectedId( presentedSites[ 0 ].site.id );
		}
	}, [ isSingleSite, presentedSites ] );

	useEffect( () => {
		if ( selectedId && ! filteredSites.some( ( entry ) => entry.site.id === selectedId ) ) {
			setSelectedId( null );
		}
	}, [ filteredSites, selectedId ] );

	useEffect( () => () => setProgress( null ), [ setProgress ] );

	const retry = useCallback( () => {
		void Promise.all( [ remoteSites.refetch(), connections.refetch() ] );
	}, [ remoteSites, connections ] );

	const handleConnect = useCallback( async () => {
		if ( ! selectedSite || isConnecting || isOffline ) return;
		setIsConnecting( true );
		setSubmitError( '' );
		const localName = getSiteName( selectedSite );

		try {
			const sitePath = await findAvailableSitePath( localName, connector.generateProposedSitePath );
			await runConnectSiteLifecycle( {
				backgroundAfterConnection: true,
				createLocalSite: () =>
					createSite.mutateAsync( {
						name: sitePath.name,
						path: sitePath.path,
						skipStart: true,
					} ),
				persistConnection: async ( localSiteId ) => {
					await connector.connectWpcomSite( localSiteId, {
						...selectedSite,
						localSiteId,
						syncSupport: 'already-connected',
					} );
					void connections.refetch();
				},
				pullRemoteSite: ( localSiteId ) =>
					pullSite.mutateAsync( {
						siteId: localSiteId,
						remoteSiteId: selectedSite.id,
					} ),
				startLocalSite: ( localSiteId ) => startSite.mutateAsync( localSiteId ),
				openLocalSite: ( localSiteId ) =>
					navigate( {
						to: '/sites/$siteId/overview',
						params: { siteId: localSiteId },
						search: { sync: 'pull' },
					} ),
				deleteLocalSite: ( localSiteId ) =>
					deleteSite.mutateAsync( { id: localSiteId, deleteFiles: true } ),
				onStage: ( stage ) => {
					const messages = {
						create: __( 'Creating the local site…' ),
						connect: __( 'Saving the WordPress.com connection…' ),
						pull: __( 'Pulling the live site into Studio…' ),
						start: __( 'Starting the local site…' ),
						open: __( 'Opening the local site…' ),
					};
					setProgress( messages[ stage ] );
				},
				onBackgroundError: ( error ) => {
					if ( error.localSiteId ) {
						reportSyncError( error.localSiteId, 'pull', error.message );
					}
				},
			} );
		} catch ( error ) {
			if (
				error instanceof ConnectSiteLifecycleError &&
				error.connectionPersisted &&
				error.localSiteId
			) {
				toast.error(
					__( 'Setup did not finish. The local site and WordPress.com connection were kept.' )
				);
				await navigate( {
					to: '/sites/$siteId/overview',
					params: { siteId: error.localSiteId },
				} );
			} else {
				setSubmitError(
					error instanceof Error
						? error.message
						: __( 'Failed to connect the site. Please try again.' )
				);
			}
		} finally {
			setProgress( null );
			setIsConnecting( false );
		}
	}, [
		selectedSite,
		isConnecting,
		isOffline,
		connector,
		createSite,
		connections,
		pullSite,
		startSite,
		navigate,
		deleteSite,
		setProgress,
	] );

	return (
		<div className={ `${ sharedStyles.page } ${ styles.page }` }>
			<h1 className={ sharedStyles.title }>
				{ user && isSingleSite ? __( 'Connect your site' ) : __( 'Connect a site' ) }
			</h1>
			<p className={ sharedStyles.subtitle }>
				{ user
					? __( 'Choose a WordPress.com or Pressable site to pull into Studio.' )
					: __( 'Sign in to find a live site and create its local copy.' ) }
			</p>

			{ isAuthLoading && (
				<div className={ styles.state } role="status">
					<Spinner />
					<p>{ __( 'Checking your account…' ) }</p>
				</div>
			) }
			{ ! isAuthLoading && ! user && <SignedOutView /> }

			{ user && isOffline && (
				<div className={ styles.state } role="status">
					<h2>{ __( "You're offline" ) }</h2>
					<p>{ __( 'Reconnect to load your WordPress.com and Pressable sites.' ) }</p>
				</div>
			) }

			{ user && ! isOffline && isLoadingSites && (
				<div className={ styles.state } role="status">
					<Spinner />
					<p>{ __( 'Loading all your sites…' ) }</p>
				</div>
			) }

			{ user && ! isOffline && ! isLoadingSites && loadError && (
				<div className={ styles.state }>
					<h2>{ __( "We couldn't load your sites" ) }</h2>
					<p>{ __( 'Check your connection and try again.' ) }</p>
					<Button
						type="button"
						variant="outline"
						tone="neutral"
						loading={ remoteSites.isFetching || connections.isFetching }
						onClick={ retry }
					>
						{ __( 'Retry' ) }
					</Button>
				</div>
			) }

			{ user && ! isOffline && ! isLoadingSites && ! loadError && presentedSites.length === 0 && (
				<div className={ styles.state }>
					<h2>{ __( 'No sites found' ) }</h2>
					<p>{ __( 'This account has no WordPress.com or Pressable sites to show.' ) }</p>
					<Button
						type="button"
						variant="minimal"
						tone="brand"
						onClick={ () => void connector.openExternalUrl( CREATE_WPCOM_SITE_URL ) }
					>
						<span>{ __( 'Create a WordPress.com site' ) }</span>
						<Icon icon={ external } size={ 14 } />
					</Button>
				</div>
			) }

			{ user && ! isOffline && ! isLoadingSites && ! loadError && presentedSites.length > 0 && (
				<>
					{ ! isSingleSite && (
						<label className={ styles.search }>
							<Icon icon={ search } size={ 18 } />
							<span className={ styles.visuallyHidden }>{ __( 'Search sites' ) }</span>
							<input
								type="search"
								placeholder={ __( 'Search sites' ) }
								value={ searchQuery }
								onChange={ ( event ) => setSearchQuery( event.target.value ) }
							/>
						</label>
					) }

					{ filteredSites.length === 0 ? (
						<div className={ styles.state } role="status">
							<p>
								{ sprintf(
									// translators: %s is the site search query.
									__( 'No sites match “%s”.' ),
									searchQuery
								) }
							</p>
						</div>
					) : isSingleSite ? (
						<ul className={ `${ styles.siteGrid } ${ styles.singleSiteGrid }` }>
							<RemoteSiteCard
								{ ...filteredSites[ 0 ] }
								isSelected={ selectedId === filteredSites[ 0 ].site.id }
								onSelect={ setSelectedId }
							/>
						</ul>
					) : (
						<div className={ styles.sections }>
							{ sections.map( ( section ) => {
								const sectionSites = filteredSites.filter(
									( entry ) => entry.group === section.key
								);
								if ( sectionSites.length === 0 ) return null;
								return (
									<section key={ section.key } className={ styles.section }>
										<div className={ styles.sectionHeader }>
											<h2>{ section.title }</h2>
											<p>{ section.description }</p>
										</div>
										<ul className={ styles.siteGrid }>
											{ sectionSites.map( ( entry ) => (
												<RemoteSiteCard
													key={ entry.site.id }
													{ ...entry }
													isSelected={ selectedId === entry.site.id }
													onSelect={ setSelectedId }
												/>
											) ) }
										</ul>
									</section>
								);
							} ) }
						</div>
					) }
				</>
			) }

			{ submitError && (
				<p role="alert" className={ styles.error }>
					{ submitError }
				</p>
			) }

			<OnboardingFooter>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					disabled={ isConnecting }
					onClick={ () => void navigate( { to: '/onboarding' } ) }
				>
					<Icon icon={ chevronLeft } size={ 16 } />
					<span>{ __( 'Back' ) }</span>
				</Button>
				{ user && (
					<Button
						type="button"
						variant="solid"
						tone="brand"
						disabled={ ! selectedSite || isOffline || isConnecting }
						loading={ isConnecting }
						onClick={ () => void handleConnect() }
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
