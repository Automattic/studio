import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useEffect } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { ConnectButton } from 'src/components/connect-create-buttons';
import offlineIcon from 'src/components/offline-icon';
import { SyncConnectedSites } from 'src/components/sync-connected-sites';
import { SyncSitesModalSelector } from 'src/components/sync-sites-modal-selector';
import { SyncTabImage } from 'src/components/sync-tab-image';
import { Tooltip } from 'src/components/tooltip';
import { WordPressShortLogo } from 'src/components/wordpress-short-logo';
import { CLIENT_ID, PROTOCOL_PREFIX, SCOPES, WP_AUTHORIZE_ENDPOINT } from 'src/constants';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
function SiteSyncDescription( { children }: PropsWithChildren ) {
	const { __ } = useI18n();
	const { pressableSyncEnabled } = useFeatureFlags();
	return (
		<div className="flex justify-between max-w-3xl gap-4">
			<div className="flex flex-col p-8">
				<div className="flex items-center mb-1">
					<div className="a8c-subtitle">{ __( 'Sync with' ) }</div>
					<WordPressShortLogo className="ms-2 h-5" />
				</div>
				<div className="max-w-[40ch] text-a8c-gray-70 a8c-body">
					{ pressableSyncEnabled
						? __(
								'Connect your existing WordPress.com or Jetpack-activated Pressable sites, or create a new one. Then, share your work with the world.'
						  )
						: __(
								'Connect an existing WordPress.com site, or create a new one and share your site with the world.'
						  ) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Push and pull changes from your live site.' ),
						__( 'Supports staging and production sites.' ),
						__( 'Sync database and file changes.' ),
					].map( ( text ) => (
						<div key={ text } className="text-a8c-gray-70 a8c-body flex items-center">
							<Icon className="fill-a8c-blueberry me-2 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<div className="flex flex-col shrink-0 items-end p-4 rtl:order-first">
				<SyncTabImage />
			</div>
		</div>
	);
}

function NoAuthSyncTab() {
	const isOffline = useOffline();
	const { __ } = useI18n();
	const { authenticate } = useAuth();
	const offlineMessage = __( "You're currently offline." );

	return (
		<SiteSyncDescription>
			<div className="mt-8">
				<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
					<Button
						aria-description={ isOffline ? offlineMessage : '' }
						aria-disabled={ isOffline }
						variant="primary"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							authenticate();
						} }
					>
						{ __( 'Log in to WordPress.com' ) }
						<ArrowIcon />
					</Button>
				</Tooltip>
			</div>
			<div className="mt-3 text-a8c-gray-70 a8c-body">
				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ offlineMessage }
					placement="bottom-start"
				>
					<span>
						{ __( 'New to WordPress.com?' ) }{ ' ' }
						<Button
							aria-description={ isOffline ? offlineMessage : '' }
							aria-disabled={ isOffline }
							className="!p-0 text-a8c-blueberry hover:opacity-80 h-auto inline-flex items-center"
							onClick={ () => {
								if ( isOffline ) {
									return;
								}
								const baseURL = 'https://wordpress.com/log-in/link';
								const authURL = encodeURIComponent(
									`${ WP_AUTHORIZE_ENDPOINT }?response_type=token&client_id=${ CLIENT_ID }&redirect_uri=${ PROTOCOL_PREFIX }%3A%2F%2Fauth&scope=${ SCOPES }&from-calypso=1`
								);
								const finalURL = `${ baseURL }?redirect_to=${ authURL }&client_id=${ CLIENT_ID }`;
								getIpcApi().openURL( finalURL );
							} }
						>
							{ __( 'Create a free account' ) }
							<ArrowIcon />
						</Button>
					</span>
				</Tooltip>
			</div>
		</SiteSyncDescription>
	);
}

export type OpenSitesSyncSelector = ( options?: { disconnectSiteId?: number } ) => void;

export function ContentTabSync( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const {
		connectedSites,
		connectSite,
		disconnectSite,
		syncSites,
		isFetching,
		refetchSites,
		isSyncSitesSelectorOpen,
		setIsSyncSitesSelectorOpen,
		closeSyncSitesSelector,
	} = useSyncSites();
	const { isAuthenticated } = useAuth();

	useEffect( () => {
		if ( isAuthenticated ) {
			refetchSites();
		}
	}, [ isAuthenticated, refetchSites ] );

	if ( ! isAuthenticated ) {
		return <NoAuthSyncTab />;
	}

	const handleConnect = async ( newConnectedSite: SyncSite ) => {
		try {
			await connectSite( newConnectedSite );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to connect to site' ),
				message: __( 'Please try again.' ),
			} );
		}
	};

	return (
		<div className="flex flex-col gap-4 h-full">
			{ connectedSites.length > 0 ? (
				<SyncConnectedSites
					connectedSites={ connectedSites }
					selectedSite={ selectedSite }
					openSitesSyncSelector={ ( options ) => setIsSyncSitesSelectorOpen( options || true ) }
					disconnectSite={ ( id: number ) => disconnectSite( id ) }
				/>
			) : (
				<SiteSyncDescription>
					<div className="mt-8">
						<ConnectButton
							variant="primary"
							connectSite={ () => setIsSyncSitesSelectorOpen( true ) }
							disableConnectButtonStyle={ true }
						/>
					</div>
				</SiteSyncDescription>
			) }

			{ isSyncSitesSelectorOpen && (
				<SyncSitesModalSelector
					isLoading={ isFetching }
					onRequestClose={ closeSyncSitesSelector }
					syncSites={ syncSites }
					onInitialRender={ refetchSites }
					onConnect={ async ( siteId ) => {
						const disconnectSiteId =
							typeof isSyncSitesSelectorOpen === 'object'
								? isSyncSitesSelectorOpen.disconnectSiteId
								: undefined;

						if ( disconnectSiteId ) {
							await disconnectSite( disconnectSiteId );
						}

						const newConnectedSite = syncSites.find( ( site ) => site.id === siteId );
						if ( ! newConnectedSite ) {
							getIpcApi().showErrorMessageBox( {
								title: __( 'Failed to connect to site' ),
								message: __( 'Please try again.' ),
							} );
							return;
						}
						handleConnect( newConnectedSite );
					} }
					selectedSite={ selectedSite }
				/>
			) }
		</div>
	);
}
