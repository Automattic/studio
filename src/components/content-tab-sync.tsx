import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useState } from 'react';
import { CLIENT_ID, PROTOCOL_PREFIX, SCOPES, WP_AUTHORIZE_ENDPOINT } from '../constants';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { useSyncSites } from '../hooks/use-sync-sites';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { ArrowIcon } from './arrow-icon';
import Button from './button';
import offlineIcon from './offline-icon';
import { SyncConnectedSites } from './sync-connected-sites';
import { SyncSitesModalSelector } from './sync-sites-modal-selector';
import { SyncTabImage } from './sync-tab-image';
import Tooltip from './tooltip';
import { WordPressShortLogo } from './wordpress-short-logo';

function SiteSyncDescription( { children }: PropsWithChildren ) {
	const { __ } = useI18n();
	return (
		<div className="flex justify-between max-w-3xl gap-4">
			<div className="flex flex-col p-8">
				<div className="flex items-center mb-1">
					<div className="a8c-subtitle">{ __( 'Sync with' ) }</div>
					<WordPressShortLogo className="ml-2 h-5" />
				</div>
				<div className="max-w-[40ch] text-a8c-gray-70 a8c-body pr-2">
					{ __(
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
							<Icon className="fill-a8c-blueberry mr-2 shrink-0" icon={ check } /> { text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<div className="flex flex-col shrink-0 items-end p-4">
				<SyncTabImage />
			</div>
		</div>
	);
}

function CreateConnectSite( {
	openSitesSyncSelector,
}: {
	className?: string;
	openSitesSyncSelector: () => void;
} ) {
	const { __ } = useI18n();
	const isOffline = useOffline();

	const offlineMessageCreate = __( 'Creating new site requires an internet connection.' );
	const offlineMessageConnect = __( 'Connecting a site requires an internet connection.' );

	return (
		<div className="mt-8">
			<div className="flex gap-4">
				<Tooltip disabled={ ! isOffline } text={ offlineMessageConnect }>
					<Button
						aria-disabled={ isOffline }
						variant="primary"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							openSitesSyncSelector();
						} }
					>
						{ __( 'Connect site' ) }
					</Button>
				</Tooltip>
				<Tooltip disabled={ ! isOffline } text={ offlineMessageCreate }>
					<Button
						aria-disabled={ isOffline }
						className={ cx( ! isOffline && '!text-a8c-blueberry !shadow-a8c-blueberry' ) }
						variant="secondary"
						onClick={ async () => {
							if ( isOffline ) {
								return;
							}
							await getIpcApi().openURL( 'https://wordpress.com/start/new-site' );
						} }
					>
						{ __( 'Create new site' ) }
						<ArrowIcon />
					</Button>
				</Tooltip>
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
			<div className="mt-3 w-[40ch] text-a8c-gray-70 a8c-body">
				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ offlineMessage }
					placement="bottom-start"
				>
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
				</Tooltip>
			</div>
		</SiteSyncDescription>
	);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ContentTabSync( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const { syncSites, connectedSites, setConnectedSites, isFetching } = useSyncSites();
	const [ isSyncSitesSelectorOpen, setIsSyncSitesSelectorOpen ] = useState( false );
	const { isAuthenticated } = useAuth();
	if ( ! isAuthenticated ) {
		return <NoAuthSyncTab />;
	}

	return (
		<div className="flex flex-col gap-4 h-full">
			{ connectedSites.length > 0 ? (
				<SyncConnectedSites
					syncSites={ syncSites }
					connectedSites={ connectedSites }
					openSitesSyncSelector={ () => setIsSyncSitesSelectorOpen( true ) }
					disconnectSite={ ( id ) => {
						setConnectedSites( ( prevState ) => prevState.filter( ( site ) => site.id !== id ) );
					} }
				/>
			) : (
				<SiteSyncDescription>
					<CreateConnectSite openSitesSyncSelector={ () => setIsSyncSitesSelectorOpen( true ) } />
				</SiteSyncDescription>
			) }

			{ isSyncSitesSelectorOpen && (
				<SyncSitesModalSelector
					isLoading={ isFetching }
					onRequestClose={ () => setIsSyncSitesSelectorOpen( false ) }
					syncSites={ syncSites }
					onConnect={ ( siteId ) => {
						const newConnectedSite = syncSites.find( ( site ) => site.id === siteId );
						if ( ! newConnectedSite ) {
							getIpcApi().showErrorMessageBox( {
								title: __( 'Failed to connect to site' ),
								message: __( 'Please try again.' ),
							} );
							return;
						}
						setConnectedSites( ( prevState ) => [ ...prevState, newConnectedSite ] );
					} }
				/>
			) }
		</div>
	);
}
