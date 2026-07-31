import { createRoute, useNavigate } from '@tanstack/react-router';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { check, chevronLeft, external } from '@wordpress/icons';
import { Button, Icon } from '@wordpress/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConnectSitePicker, getSiteName } from '@/components/connect-site-picker';
import { presentRemoteSites } from '@/components/connect-site-picker/site-presentation';
import { OnboardingFooter } from '@/components/onboarding-footer';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useCreateSite, useDeleteSite, useSites, useStartSite } from '@/data/queries/use-sites';
import { usePullSiteFromLive } from '@/data/queries/use-sync-site';
import { useSyncableWpcomSites } from '@/data/queries/use-wpcom-sites';
import { useOffline } from '@/hooks/use-offline';
import { onboardingLayoutRoute, useOnboardingProgress } from '../layout-onboarding';
import sharedStyles from '../layout-onboarding/style.module.css';
import { ConnectSiteLifecycleError, runConnectSiteLifecycle } from './connect-site';
import styles from './style.module.css';

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
	const createSite = useCreateSite();
	const deleteSite = useDeleteSite();
	const pullSite = usePullSiteFromLive();
	const startSite = useStartSite();
	const [ selectedId, setSelectedId ] = useState< number | null >( null );
	const [ isConnecting, setIsConnecting ] = useState( false );
	const [ submitError, setSubmitError ] = useState( '' );

	const presentedSites = useMemo(
		() => presentRemoteSites( remoteSites.data ?? [] ),
		[ remoteSites.data ]
	);
	const isSingleAvailableSite =
		presentedSites.length === 1 && presentedSites[ 0 ].group === 'available';
	const selectedSite = presentedSites.find(
		( entry ) => entry.site.id === selectedId && entry.group === 'available'
	)?.site;
	useEffect( () => {
		if ( isSingleAvailableSite ) {
			setSelectedId( presentedSites[ 0 ].site.id );
		}
	}, [ isSingleAvailableSite, presentedSites ] );

	useEffect( () => () => setProgress( null ), [ setProgress ] );

	const retry = useCallback( () => {
		void remoteSites.refetch();
	}, [ remoteSites ] );

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
		pullSite,
		startSite,
		navigate,
		deleteSite,
		setProgress,
	] );

	return (
		<div className={ `${ sharedStyles.page } ${ styles.page }` }>
			<h1 className={ sharedStyles.title }>
				{ user && isSingleAvailableSite ? __( 'Connect your site' ) : __( 'Connect a site' ) }
			</h1>
			<p className={ sharedStyles.subtitle }>
				{ user
					? __( 'Select a WordPress.com or Pressable site to bring into your Studio.' )
					: __( 'Log in with your WordPress.com account to see your sites.' ) }
			</p>
			{ submitError && (
				<p role="alert" className={ `${ sharedStyles.progress } ${ styles.connectError }` }>
					{ submitError }
				</p>
			) }

			{ isAuthLoading && (
				<div className={ styles.state } role="status">
					<Spinner />
					<p>{ __( 'Checking your account…' ) }</p>
				</div>
			) }
			{ ! isAuthLoading && ! user && <SignedOutView /> }

			{ user && (
				<ConnectSitePicker
					sites={ remoteSites.data }
					isLoading={ remoteSites.isLoading }
					isFetching={ remoteSites.isFetching }
					error={ remoteSites.error }
					onRefresh={ retry }
					selectedId={ selectedId }
					onSelect={ setSelectedId }
				/>
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
