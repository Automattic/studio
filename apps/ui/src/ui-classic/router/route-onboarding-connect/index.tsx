import { createRoute, useNavigate } from '@tanstack/react-router';
import { Spinner, VisuallyHidden } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { check, chevronLeft, external, search } from '@wordpress/icons';
import { Badge, Button, Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useCreateSite, useDeleteSite, useSites, useStartSite } from '@/data/queries/use-sites';
import { usePullSiteFromLive } from '@/data/queries/use-sync-site';
import { useAllConnectedWpcomSites, useSyncableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { useOffline } from '@/hooks/use-offline';
import { onboardingLayoutRoute, useOnboardingProgress } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import { ConnectSiteLifecycleError, runConnectSiteLifecycle } from './connect-site';
import { presentRemoteSites, searchRemoteSites, type ConnectSiteGroup } from './site-presentation';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';

const createWpcomSiteUrl = new URL( 'https://wordpress.com/setup/new-hosted-site' );
createWpcomSiteUrl.searchParams.set( 'ref', 'studio' );
createWpcomSiteUrl.searchParams.set( 'section', 'studio-sync' );
createWpcomSiteUrl.searchParams.set( 'showDomainStep', 'true' );

function getEnvironmentLabel( site: SyncSite ): string {
	if ( site.isPressable && site.environmentType === 'development' ) return __( 'Development' );
	if ( site.isPressable && site.environmentType === 'staging' ) return __( 'Staging' );
	if ( site.isStaging ) return __( 'Staging' );
	return __( 'Production' );
}

function getEnvironmentIntent( site: SyncSite ) {
	if ( site.isPressable && site.environmentType === 'development' ) return 'informational';
	if ( site.isStaging || ( site.isPressable && site.environmentType === 'staging' ) )
		return 'medium';
	return 'stable';
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
	const statusId = useId();
	const isAvailable = group === 'available';
	const siteStatus = isAvailable ? '' : getSiteStatus( site, group, connectedLocalSiteNames );
	const className = clsx(
		styles.siteCard,
		isSelected && styles.siteCardSelected,
		! isAvailable && styles.siteCardUnavailable
	);

	return (
		<li className={ styles.siteCardWrapper }>
			<button
				type="button"
				className={ className }
				aria-pressed={ isAvailable ? isSelected : undefined }
				aria-disabled={ ! isAvailable || undefined }
				aria-describedby={ siteStatus ? statusId : undefined }
				onClick={ () => isAvailable && onSelect( site.id ) }
			>
				<span className={ styles.siteThumb }>
					<img
						src={ `https://s0.wp.com/mshots/v1/${ encodeURIComponent( site.url ) }?w=600&h=400` }
						alt=""
						loading="lazy"
					/>
				</span>
				<span className={ styles.siteText }>
					<span className={ styles.siteName }>{ getSiteName( site ) }</span>
					<span className={ styles.siteUrl }>{ site.url.replace( /^https?:\/\//, '' ) }</span>
					<span className={ styles.badges }>
						<Badge intent="draft">
							{ site.isPressable ? __( 'Pressable' ) : __( 'WordPress.com' ) }
						</Badge>
						<Badge intent={ getEnvironmentIntent( site ) }>{ getEnvironmentLabel( site ) }</Badge>
					</span>
					{ siteStatus && (
						<span id={ statusId } className={ styles.siteStatus }>
							{ siteStatus }
						</span>
					) }
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
				<li>
					<Icon icon={ check } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Work on your site locally.' ) }</span>
				</li>
				<li>
					<Icon icon={ check } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Sync content, themes, and plugins.' ) }</span>
				</li>
				<li>
					<Icon icon={ check } size={ 16 } aria-hidden="true" />
					<span>{ __( 'Supports staging and production sites.' ) }</span>
				</li>
			</ul>
			<div className={ styles.authActions }>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					disabled={ isOffline || login.isPending }
					loading={ signup.isPending }
					onClick={ () => signup.mutate() }
				>
					<span>{ __( 'Sign up' ) }</span>
					<Icon icon={ external } size={ 14 } aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="solid"
					tone="brand"
					disabled={ isOffline || signup.isPending }
					loading={ login.isPending }
					onClick={ () => login.mutate() }
				>
					<span>{ __( 'Log in with WordPress.com' ) }</span>
					<Icon icon={ external } size={ 14 } aria-hidden="true" />
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
	const remoteSites = useSyncableWpcomSites( {
		enabled: !! user && ! isOffline,
	} );
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
	const isLoadingSites = remoteSites.isLoading || connections.isLoading;
	const loadError = remoteSites.error ?? connections.error;

	const sections: { key: ConnectSiteGroup; title: string; description: string }[] = [
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
	];

	useEffect( () => {
		if ( isSingleSite && presentedSites[ 0 ]?.group === 'available' ) {
			setSelectedId( presentedSites[ 0 ].site.id );
		}
	}, [ isSingleSite, presentedSites ] );

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
			const name = await connector.generateNumberedSiteName( localName, localSites );
			const { path } = await connector.generateProposedSitePath( name );
			await runConnectSiteLifecycle( {
				createLocalSite: () =>
					createSite.mutateAsync( {
						name,
						path,
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
						open: __( 'Opening the local site…' ),
					};
					setProgress( messages[ stage ] );
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
		localSites,
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
					: __( 'Log in with your WordPress.com account to see your sites.' ) }
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
					<p>{ __( 'Loading your sites…' ) }</p>
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
						onClick={ () => void connector.openExternalUrl( createWpcomSiteUrl.toString() ) }
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
							<VisuallyHidden as="span">{ __( 'Search sites' ) }</VisuallyHidden>
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
