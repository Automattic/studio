import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useCallback, useEffect, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
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
import type { SyncSite } from 'src/modules/sync/types';

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
	const selectedRemoteSiteId = useRootSelector(
		connectedSitesSelectors.selectSelectedRemoteSiteId
	);
	const { isAuthenticated, user } = useAuth();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const [ connectSite, { isLoading: isConnecting } ] = useConnectSiteMutation();
	const [ disconnectSite ] = useDisconnectSiteMutation();
	const { pushSite, pullSite } = useSyncSites();

	const connectedSiteIds = connectedSites.map( ( { id } ) => id );
	const { data: syncSites = [] } = useGetWpComSitesQuery( {
		connectedSiteIds,
		userId: user?.id,
	} );

	// Merge connectedSites with syncSites to get the most up-to-date data
	// This ensures the Sync tab shows current data even before reconciliation updates storage
	const mergedConnectedSites = connectedSites.map( ( connectedSite ) => {
		const syncSite = syncSites.find( ( site ) => site.id === connectedSite.id );
		// If we have data from the API (syncSites), use it; otherwise use storage data
		return syncSite || connectedSite;
	} );

	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | null >( null );

	// Check if connection is ready using RTK Query's built-in loading state
	const isConnectionReady = ! isConnecting;

	// Auto-select remote site when set via Redux (e.g., from deep link connection)
	useEffect( () => {
		if ( selectedRemoteSiteId ) {
			const siteToSelect = syncSites.find( ( site ) => site.id === selectedRemoteSiteId );
			if ( siteToSelect ) {
				setSelectedRemoteSite( siteToSelect );
				dispatch( connectedSitesActions.openModal( 'push' ) );
				dispatch( connectedSitesActions.clearSelectedRemoteSiteId() );
			}
		}
	}, [ selectedRemoteSiteId, syncSites, dispatch ] );

	// Update selectedRemoteSite when syncSites updates with more complete data
	// This ensures the modal shows updated site info when background refetch completes
	useEffect( () => {
		if ( selectedRemoteSite ) {
			const updatedSite = syncSites.find( ( site ) => site.id === selectedRemoteSite.id );
			if ( updatedSite && updatedSite !== selectedRemoteSite ) {
				// Update with the more complete site data from refetch
				setSelectedRemoteSite( updatedSite );
			}
		}
	}, [ syncSites, selectedRemoteSite ] );

	const handleConnect = useCallback(
		async ( newConnectedSite: SyncSite ) => {
			// Check if already connected (use connectedSites from storage as source of truth)
			const isAlreadyConnected = connectedSites.some( ( site ) => site.id === newConnectedSite.id );
			if ( isAlreadyConnected ) {
				// Site is already connected, no need to reconnect
				return;
			}

			// Note: Connection status check is handled by the disabled button state
			// If connection is pending, the button will be disabled

			try {
				await connectSite( { site: newConnectedSite, localSiteId: selectedSite.id } );
			} catch ( error ) {
				getIpcApi().showErrorMessageBox( {
					title: __( 'Failed to connect to site' ),
					message: __( 'Please try again.' ),
				} );
			}
		},
		[ connectedSites, connectSite, selectedSite.id, __ ]
	);

	if ( ! isAuthenticated ) {
		return <NoAuthSyncTab />;
	}

	const handleSiteSelection = async ( siteId: number ) => {
		const selectedSiteFromList = syncSites.find( ( site ) => site.id === siteId );
		if ( ! selectedSiteFromList ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to select site' ),
				message: __( 'Please try again.' ),
			} );
			return;
		}

		if ( reduxModalMode === 'push' || reduxModalMode === 'pull' ) {
			dispatch( connectedSitesActions.openModal( reduxModalMode ) );
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
						connectedSites={ mergedConnectedSites }
						selectedSite={ selectedSite }
						disconnectSite={ ( id ) =>
							disconnectSite( { siteId: id, localSiteId: selectedSite.id } )
						}
					/>
					<div className="sticky bottom-0 bg-white/[0.8] backdrop-blur-sm w-full px-8 py-6 mt-auto">
						<ConnectButton
							variant="primary"
							connectSite={ () => dispatch( connectedSitesActions.openModal( 'connect' ) ) }
						>
							{ __( 'Connect another site' ) }
						</ConnectButton>
					</div>
				</div>
			) : (
				<SiteSyncDescription>
					<div className="mt-8">
						<ConnectButton
							variant="primary"
							connectSite={ () => dispatch( connectedSitesActions.openModal( 'connect' ) ) }
						>
							{ __( 'Connect site' ) }
						</ConnectButton>
					</div>
				</SiteSyncDescription>
			) }

			{ isModalOpen && ! selectedRemoteSite && (
				<SyncSitesModalSelector
					mode={ reduxModalMode || 'connect' }
					onRequestClose={ () => {
						dispatch( connectedSitesActions.closeModal() );
					} }
					onConnect={ async ( siteId: number ) => {
						await handleSiteSelection( siteId );
					} }
					selectedSite={ selectedSite }
				/>
			) }

			{ reduxModalMode && reduxModalMode !== 'connect' && selectedRemoteSite && (
				<SyncDialog
					type={ reduxModalMode }
					localSite={ selectedSite }
					remoteSite={ selectedRemoteSite }
					isConnectionReady={ isConnectionReady }
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
