import {
	__experimentalHeading as Heading,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { NoWpcomSitesContent } from 'src/modules/sync/components/no-wpcom-sites-content';
import { SitesListContent } from 'src/modules/sync/components/sync-sites-modal-selector';
import { SyncTabImage } from 'src/modules/sync/components/sync-tab-image';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import type { SyncSite } from 'src/modules/sync/types';

function SiteSyncDescription( { children }: PropsWithChildren ) {
	const { __ } = useI18n();
	return (
		<div className="p-8 flex">
			<div className="flex flex-col">
				<div className="flex items-center mb-1">
					<div className="a8c-subtitle text-pretty">
						{ __( 'Create a new site from WordPress.com or Pressable' ) }
					</div>
				</div>
				<div className="max-w-[40ch] text-a8c-gray-70 a8c-body">
					{ __(
						'Create a new local site and pull your WordPress.com or Pressable site with Jetpack activated.'
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Create a new local WordPress site.' ),
						__( 'Pull content from your remote site.' ),
						__( 'Start working locally with your site data.' ),
					].map( ( text ) => (
						<div key={ text } className="text-a8c-gray-70 a8c-body flex items-center">
							<Icon className="fill-a8c-blue-50 me-2 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<div className="flex flex-col shrink-0 items-end">
				<SyncTabImage />
			</div>
		</div>
	);
}

function NoWpcomSitesView() {
	const { __ } = useI18n();

	return (
		<div className="p-8 flex">
			<div className="flex flex-col gap-6">
				<div className="a8c-subtitle text-pretty">{ __( 'Find a perfect plan' ) }</div>
				<NoWpcomSitesContent buttonClassName="!text-white !shadow-a8c-blue-50 mt-2" />
			</div>
			<div className="flex flex-col shrink-0 items-end">
				<SyncTabImage />
			</div>
		</div>
	);
}

function NoAuthPullRemoteSiteView() {
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
							className="!p-0 text-a8c-blue-50 hover:opacity-80 h-auto inline-flex items-center"
							onClick={ () => {
								if ( isOffline ) {
									return;
								}
								getIpcApi().authenticate( true );
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

export function PullRemoteSite( {
	setSelectedRemoteSite,
	selectedRemoteSite,
}: {
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
} ) {
	const { __ } = useI18n();
	const { isAuthenticated, user } = useAuth();

	const {
		data: syncSites = [],
		isLoading,
		isSuccess,
	} = useGetWpComSitesQuery(
		{
			userId: user?.id,
		},
		{ refetchOnMountOrArgChange: true }
	);

	const hasSites = syncSites.length > 0;
	const showNoSitesView = ! hasSites && isSuccess && ! isLoading;

	const handleSiteSelect = ( siteId: number ) => {
		const site = syncSites.find( ( s ) => s.id === siteId );
		setSelectedRemoteSite( site );
	};

	return (
		<VStack className="w-full" alignment="top" spacing={ isAuthenticated ? 3 : 1 }>
			<Heading className="text-center text-[32px] text-gray-900" weight={ 500 }>
				{ __( 'Pull an existing site' ) }
			</Heading>
			{ isAuthenticated ? (
				<VStack className="flex flex-col w-full max-w-[650px] flex-1 text-a8c-gray-900">
					{ showNoSitesView ? (
						<NoWpcomSitesView />
					) : (
						<SitesListContent
							isLoading={ isLoading }
							syncSites={ syncSites }
							selectedSiteId={ selectedRemoteSite?.id || null }
							onSelectSite={ handleSiteSelect }
						/>
					) }
				</VStack>
			) : (
				<NoAuthPullRemoteSiteView />
			) }
		</VStack>
	);
}
