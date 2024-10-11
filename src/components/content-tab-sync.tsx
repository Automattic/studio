import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import wpcomLogo from '../../assets/wpcom-logo.svg';
import { CLIENT_ID, PROTOCOL_PREFIX, SCOPES, WP_AUTHORIZE_ENDPOINT } from '../constants';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import offlineIcon from './offline-icon';
import { SyncTabImage } from './sync-tab-image';
import Tooltip from './tooltip';

function SiteSyncDesription( { children }: PropsWithChildren< { selectedSite: SiteDetails } > ) {
	const { __ } = useI18n();
	return (
		<div className="flex justify-between max-w-3xl gap-4">
			<div className="flex flex-col p-8">
				<div className="flex items-center mb-1">
					<div className="a8c-subtitle">{ __( 'Sync with' ) }</div>
					<img src={ wpcomLogo } alt="WordPress.com Logo" className="ml-2 h-5" />
				</div>
				<div className="w-[40ch] text-a8c-gray-70 a8c-body pr-2">
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

function NoAuthSyncTab( { selectedSite }: React.ComponentProps< typeof SiteSyncDesription > ) {
	const isOffline = useOffline();
	const { __ } = useI18n();
	const { authenticate } = useAuth();
	const offlineMessage = __( "You're currently offline." );

	return (
		<SiteSyncDesription selectedSite={ selectedSite }>
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
						<span className="ltr:ml-1 rtl:mr-1 rtl:scale-x-[-1]">↗</span>{ ' ' }
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
						<span className="ltr:ml-1 rtl:mr-1 rtl:scale-x-[-1]">↗</span>
					</Button>
				</Tooltip>
			</div>
		</SiteSyncDesription>
	);
}

export function ContentTabSync( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const { isAuthenticated } = useAuth();
	if ( ! isAuthenticated ) {
		return <NoAuthSyncTab selectedSite={ selectedSite } />;
	}

	return (
		<div className="flex flex-col gap-4">
			<SiteSyncDesription selectedSite={ selectedSite } />
		</div>
	);
}
