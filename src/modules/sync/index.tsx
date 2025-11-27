import { check, cloudUpload, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useCallback, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
import { NoWpcomSitesModal } from 'src/modules/sync/components/no-wpcom-sites-modal';
import { SyncConnectedSites } from 'src/modules/sync/components/sync-connected-sites';
import { SyncDialog } from 'src/modules/sync/components/sync-dialog';
import { SyncSitesModalSelector } from 'src/modules/sync/components/sync-sites-modal-selector';
import { SyncTabImage } from 'src/modules/sync/components/sync-tab-image';
import {
	convertTreeToPullOptions,
	convertTreeToPushOptions,
} from 'src/modules/sync/lib/convert-tree-to-sync-options';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	connectedSitesActions,
	connectedSitesSelectors,
	useConnectSiteMutation,
	useDisconnectSiteMutation,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import type { SyncSite, SyncModalMode } from 'src/modules/sync/types';

function SiteSyncDescription( { children }: PropsWithChildren ) {
	const { __ } = useI18n();
	return (
		<div className="p-8 flex justify-between max-w-3xl gap-4">
			<div className="flex flex-col">
				<div className="flex items-center mb-1">
					<div className="a8c-subtitle text-pretty">
						{ __( 'Sync with WordPress.com or Pressable' ) }
					</div>
				</div>
				<div className="max-w-[40ch] text-a8c-gray-70 a8c-body">
					{ __(
						'Launch your existing WordPress.com or Jetpack-activated Pressable sites, or import an existing one. Then, share your work with the world.'
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Push and pull changes from your live site.' ),
						__( 'Supports staging and production sites.' ),
						__( 'Sync database and file changes.' ),
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

export type OpenSitesSyncSelector = ( options?: { disconnectSiteId?: number } ) => void;

export function ContentTabSync( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const isModalOpen = useRootSelector( connectedSitesSelectors.selectIsModalOpen );
	const reduxModalMode = useRootSelector( connectedSitesSelectors.selectModalMode );
	const { isAuthenticated, user } = useAuth();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const [ connectSite ] = useConnectSiteMutation();
	const [ disconnectSite ] = useDisconnectSiteMutation();
	const { pushSite, pullSite, isAnySitePulling, isAnySitePushing } = useSyncSites();

	const connectedSiteIds = connectedSites.map( ( { id } ) => id );
	const {
		data: syncSites = [],
		isLoading: isLoadingSyncSites,
		isFetching: isFetchingSyncSites,
		isSuccess: isSuccessSyncSites,
		isUninitialized: isUninitializedSyncSites,
		refetch: refetchWpComSites,
	} = useGetWpComSitesQuery(
		{ connectedSiteIds, userId: user?.id },
		{ refetchOnMountOrArgChange: true }
	);

	const refetchSites = useCallback( async (): Promise< SyncSite[] > => {
		if ( isUninitializedSyncSites ) {
			return [];
		}
		try {
			const result = await refetchWpComSites();
			return result.data ?? [];
		} catch ( error ) {
			// Query might not be ready to refetch yet (e.g., was skipped due to offline)
			console.warn( 'Failed to refetch sites:', error );
			return [];
		}
	}, [ refetchWpComSites, isUninitializedSyncSites ] );

	// Helper function to open modal and refetch sites to check for newly created sites
	const handleOpenModal = useCallback(
		( mode: SyncModalMode ) => {
			if ( isAuthenticated && ! isUninitializedSyncSites ) {
				refetchWpComSites().catch( ( error ) => {
					// Query might not be ready to refetch yet (e.g., was skipped due to offline)
					// Silently ignore the error as the query will start automatically when conditions are met
					console.warn( 'Failed to refetch sites on modal open:', error );
				} );
			}
			dispatch( connectedSitesActions.openModal( mode ) );
		},
		[ dispatch, isAuthenticated, isUninitializedSyncSites, refetchWpComSites ]
	);

	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;
	const { streamlineOnboarding } = useFeatureFlags();

	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | null >( null );

	if ( ! isAuthenticated ) {
		return <NoAuthSyncTab />;
	}

	const handleConnect = async ( newConnectedSite: SyncSite ) => {
		try {
			await connectSite( { site: newConnectedSite, localSiteId: selectedSite.id } );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to connect to site' ),
				message: __( 'Please try again.' ),
			} );
		}
	};

	const handleSiteSelection = async ( siteId: number, mode: SyncModalMode | null ) => {
		const selectedSiteFromList = syncSites.find( ( site ) => site.id === siteId );
		if ( ! selectedSiteFromList ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to select site' ),
				message: __( 'Please try again.' ),
			} );
			return;
		}

		if ( mode === 'push' || mode === 'pull' ) {
			handleOpenModal( mode );
			setSelectedRemoteSite( selectedSiteFromList );
		} else {
			await handleConnect( selectedSiteFromList );
			dispatch( connectedSitesActions.closeModal() );
		}
	};

	return (
		<div className="flex flex-col h-full overflow-y-auto">
			{ connectedSites.length > 0 ? (
				<div className="h-full relative">
					<SyncConnectedSites
						connectedSites={ connectedSites }
						selectedSite={ selectedSite }
						disconnectSite={ ( id ) =>
							disconnectSite( { siteId: id, localSiteId: selectedSite.id } )
						}
					/>
					<div className="sticky bottom-0 bg-white/[0.8] backdrop-blur-sm w-full px-8 py-6 mt-auto">
						<ConnectButton variant="primary" connectSite={ () => handleOpenModal( 'connect' ) }>
							{ __( 'Connect another site' ) }
						</ConnectButton>
					</div>
				</div>
			) : (
				<SiteSyncDescription>
					{ streamlineOnboarding ? (
						<div className="mt-8 flex flex-wrap gap-4">
							<ConnectButton
								variant="primary"
								icon={ cloudUpload }
								connectSite={ () => handleOpenModal( 'push' ) }
								disabled={ isAnySiteSyncing }
								isBusy={ isFetchingSyncSites }
								tooltipText={
									isAnySiteSyncing
										? __(
												'Another site is syncing. Please wait for the sync to finish before you publish your site.'
										  )
										: __( 'Publishing your site requires an internet connection.' )
								}
							>
								{ __( 'Publish site' ) }
							</ConnectButton>
							<ConnectButton
								variant="secondary"
								connectSite={ () => handleOpenModal( 'pull' ) }
								className={ isAnySiteSyncing ? '' : '!text-a8c-blue-50 !shadow-a8c-blue-50' }
								disabled={ isAnySiteSyncing }
								tooltipText={
									isAnySiteSyncing
										? __(
												'Another site is syncing. Please wait for the sync to finish before you pull a site.'
										  )
										: __( 'Importing a remote site requires an internet connection.' )
								}
							>
								{ __( 'Pull site' ) }
							</ConnectButton>
						</div>
					) : (
						<div className="mt-8">
							<ConnectButton variant="primary" connectSite={ () => handleOpenModal( 'connect' ) }>
								{ __( 'Connect site' ) }
							</ConnectButton>
						</div>
					) }
				</SiteSyncDescription>
			) }

			{ isModalOpen && (
				<>
					{ syncSites.length === 0 &&
					isSuccessSyncSites &&
					! isLoadingSyncSites &&
					! isUninitializedSyncSites ? (
						<NoWpcomSitesModal
							onRequestClose={ () => {
								dispatch( connectedSitesActions.closeModal() );
							} }
							selectedSite={ selectedSite }
						/>
					) : (
						<SyncSitesModalSelector
							mode={ reduxModalMode || 'connect' }
							isLoading={ isLoadingSyncSites }
							onRequestClose={ () => {
								dispatch( connectedSitesActions.closeModal() );
							} }
							syncSites={ syncSites }
							onInitialRender={ refetchSites }
							onConnect={ async ( siteId: number ) => {
								await handleSiteSelection( siteId, reduxModalMode );
							} }
							selectedSite={ selectedSite }
						/>
					) }
				</>
			) }

			{ reduxModalMode && reduxModalMode !== 'connect' && selectedRemoteSite && (
				<SyncDialog
					type={ reduxModalMode }
					localSite={ selectedSite }
					remoteSite={ selectedRemoteSite }
					onPush={ async ( tree ) => {
						await handleConnect( selectedRemoteSite );
						const pushOptions = convertTreeToPushOptions( tree );
						void pushSite( selectedRemoteSite, selectedSite, pushOptions );
					} }
					onPull={ async ( tree ) => {
						await handleConnect( selectedRemoteSite );
						const pullOptions = convertTreeToPullOptions( tree );
						void pullSite( selectedRemoteSite, selectedSite, pullOptions );
					} }
					onRequestClose={ () => {
						setSelectedRemoteSite( null );
						dispatch( connectedSitesActions.closeModal() );
					} }
				/>
			) }
		</div>
	);
}
