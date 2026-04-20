import {
	__experimentalHeading as Heading,
	__experimentalText as Text,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { check, Icon, wordpress } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, PropsWithChildren } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { IllustrationGrid } from 'src/components/illustration-grid';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	SiteItem,
	SitesHelperLinks,
	SitesListContent,
	useSitesQuery,
} from 'src/modules/sync/components/sync-sites-modal-selector';
import { SyncTabImage } from 'src/modules/sync/components/sync-tab-image';
import type { SyncSite } from '@studio/common/types/sync';

function SiteSyncDescription( { children }: PropsWithChildren ) {
	const { __ } = useI18n();
	return (
		<div className="p-8 flex justify-center gap-12">
			<div className="flex flex-col max-w-sm">
				<div className="a8c-subtitle text-pretty">{ __( 'Sign in to get started' ) }</div>
				<div className="max-w-[40ch] text-frame-text-secondary a8c-body mt-2">
					{ __( 'Connect your WordPress.com account to access your sites.' ) }
				</div>
				<div className="mt-5 flex flex-col gap-1">
					{ [
						__( 'Work on your site locally.' ),
						__( 'Sync content, themes, and plugins.' ),
						__( 'Supports staging and production sites.' ),
					].map( ( text ) => (
						<div key={ text } className="text-frame-text-secondary a8c-body flex items-center">
							<Icon className="fill-frame-theme me-2 shrink-0" icon={ check } size={ 20 } />
							{ text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<IllustrationGrid>
				<SyncTabImage />
			</IllustrationGrid>
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
						className="!gap-2"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							authenticate();
						} }
					>
						<Icon icon={ wordpress } size={ 20 } />
						{ __( 'Log in with WordPress.com' ) }
					</Button>
				</Tooltip>
			</div>
			<div className="mt-3 text-frame-text-secondary a8c-body">
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
							className="!p-0 text-frame-theme hover:opacity-80 h-auto inline-flex items-center"
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

	const sitesQuery = useSitesQuery( { userId: user?.id } );

	const handleSiteSelect = ( siteId: number ) => {
		const site = sitesQuery.sites.find( ( s ) => s.id === siteId );
		setSelectedRemoteSite( site );
	};

	const isSingleSite = isAuthenticated && ! sitesQuery.isLoading && sitesQuery.sites.length === 1;
	const singleSite = isSingleSite ? sitesQuery.sites[ 0 ] : undefined;
	const singleSiteId = singleSite?.id;

	// Auto-select the only syncable site so the user can proceed directly
	useEffect( () => {
		if (
			singleSite &&
			singleSite.syncSupport === 'syncable' &&
			selectedRemoteSite?.id !== singleSite.id
		) {
			setSelectedRemoteSite( singleSite );
		}
		// Only run when the single site identity changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ singleSiteId ] );

	// Clear the selection if the currently selected site is no longer syncable
	// (e.g. after the site list refreshes or its status changes).
	useEffect( () => {
		if ( ! selectedRemoteSite || sitesQuery.isLoading ) {
			return;
		}
		const current = sitesQuery.sites.find( ( s ) => s.id === selectedRemoteSite.id );
		if ( ! current || current.syncSupport !== 'syncable' ) {
			setSelectedRemoteSite( undefined );
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ sitesQuery.sites, sitesQuery.isLoading ] );

	return (
		<VStack className="w-full h-full pt-16" alignment="top" spacing={ 0 }>
			<div>
				<Heading className="text-center text-[32px] text-frame-text mb-2" weight={ 500 }>
					{ isSingleSite ? __( 'Connect your site' ) : __( 'Connect a site' ) }
				</Heading>
				<Text className="text-center text-[15px] font-light text-frame-text-secondary block mb-3">
					{ isSingleSite
						? __( 'Ready to bring into your Studio.' )
						: __( 'Select a WordPress.com or Pressable site to bring into your Studio.' ) }
				</Text>
			</div>
			{ isAuthenticated ? (
				isSingleSite && singleSite ? (
					<div className="flex flex-col items-center w-full mt-4">
						<div className="w-full max-w-[420px]">
							<SiteItem
								site={ singleSite }
								isSelected={ selectedRemoteSite?.id === singleSite.id }
								onClick={ () => handleSiteSelect( singleSite.id ) }
							/>
						</div>
						<div className="mt-4">
							<SitesHelperLinks
								onRefresh={ sitesQuery.refetch }
								isRefreshing={ sitesQuery.isFetching }
							/>
						</div>
					</div>
				) : (
					<VStack className="flex flex-col w-full flex-1 min-h-0 text-frame-text">
						<SitesListContent
							sitesQuery={ sitesQuery }
							selectedSiteId={ selectedRemoteSite?.id || null }
							onSelectSite={ handleSiteSelect }
						/>
					</VStack>
				)
			) : (
				<NoAuthPullRemoteSiteView />
			) }
		</VStack>
	);
}
