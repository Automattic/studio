import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useEffect, useState } from 'react';
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
	useConnectedSitesData,
	useSyncSitesData,
	useConnectedSitesOperations,
	connectedSitesSelectors,
	connectedSitesActions,
	loadAllConnectedSites,
} from 'src/stores/sync';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
import type { SyncModalMode } from 'src/modules/sync/types';

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
						'Launch your existing WordPress.com or Jetpack-activated Pressable sites, or import an exisiting one. Then, share your work with the world.'
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
	const { connectedSites } = useConnectedSitesData();
	const { syncSites, isFetching, refetchSites } = useSyncSitesData();
	const { connectSite, disconnectSite } = useConnectedSitesOperations();
	const { pushSite, pullSite } = useSyncSites();

	// Simplified state management - combine related modal state into single object
	type ModalState = {
		mode: SyncModalMode | null;
		selectedRemoteSite: SyncSite | null;
		syncDialogType: Extract< SyncModalMode, 'push' | 'pull' > | null;
	};

	const [ modalState, setModalState ] = useState< ModalState >( {
		mode: null,
		selectedRemoteSite: null,
		syncDialogType: null,
	} );

	const { isAuthenticated } = useAuth();

	useEffect( () => {
		if ( isAuthenticated ) {
			void refetchSites();
		}
	}, [ isAuthenticated, refetchSites ] );

	if ( ! isAuthenticated ) {
		return <NoAuthSyncTab />;
	}

	const handleConnect = async ( newConnectedSite: SyncSite ): Promise< SyncSite | undefined > => {
		try {
			await connectSite( newConnectedSite );

			await dispatch( loadAllConnectedSites() );
			// Use Redux store as source of truth - find the site we just connected
			const connectedSite = connectedSites.find( ( site ) => site.id === newConnectedSite.id );
			// Return the connected site with full metadata, or fallback to the original site
			return connectedSite || newConnectedSite;
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to connect to site' ),
				message: __( 'Please try again.' ),
			} );
		}
	};

	const handleLaunchSite = () => {
		setModalState( ( prev ) => ( { ...prev, mode: 'push' } ) );
		dispatch( connectedSitesActions.openModal() );
	};

	const handleImportSite = () => {
		setModalState( ( prev ) => ( { ...prev, mode: 'pull' } ) );
		dispatch( connectedSitesActions.openModal() );
	};

	// Unified handler for site selection with optional post-connection callback
	const handleSiteSelection = async (
		siteId: number,
		onAfterConnect?: ( site: SyncSite ) => void
	) => {
		const disconnectSiteId =
			typeof isModalOpen === 'object' ? isModalOpen.disconnectSiteId : undefined;

		if ( disconnectSiteId ) {
			await disconnectSite( disconnectSiteId );
		}

		const selectedSiteFromList = syncSites.find( ( site ) => site.id === siteId );
		if ( ! selectedSiteFromList ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to select site' ),
				message: __( 'Please try again.' ),
			} );
			return;
		}

		// Check if site is already connected
		const isAlreadyConnected = connectedSites.some( ( site ) => site.id === siteId );

		let siteToUse = selectedSiteFromList;
		if ( ! isAlreadyConnected ) {
			siteToUse = await handleConnect( selectedSiteFromList );
			if ( ! siteToUse ) {
				return;
			}
		} else {
			// Use the already connected site (it has more metadata)
			siteToUse = connectedSites.find( ( site ) => site.id === siteId ) || selectedSiteFromList;
		}

		// Close the modal
		dispatch( connectedSitesActions.closeModal() );
		setModalState( ( prev ) => ( { ...prev, mode: null } ) );

		// Execute post-connection callback if provided
		if ( onAfterConnect ) {
			onAfterConnect( siteToUse );
		}
	};

	return (
		<div className="flex flex-col h-full overflow-y-auto">
			{ connectedSites.length > 0 ? (
				<div className="h-full relative">
					<SyncConnectedSites
						connectedSites={ connectedSites }
						selectedSite={ selectedSite }
						disconnectSite={ disconnectSite }
					/>
					<div className="sticky bottom-0 bg-white/[0.8] backdrop-blur-sm w-full px-8 py-6 mt-auto">
						<ConnectButton
							variant="primary"
							connectSite={ () => dispatch( connectedSitesActions.openModal() ) }
							disableConnectButtonStyle={ true }
						>
							{ __( 'Connect another site' ) }
						</ConnectButton>
					</div>
				</div>
			) : (
				<SiteSyncDescription>
					<div className="mt-8 flex flex-wrap gap-4">
						<ConnectButton
							variant="primary"
							connectSite={ handleLaunchSite }
							disableConnectButtonStyle={ true }
							tooltipText={ __( 'Publishing your site requires an internet connection.' ) }
						>
							{ __( 'Publish site' ) }
						</ConnectButton>
						<ConnectButton
							variant="secondary"
							connectSite={ handleImportSite }
							disableConnectButtonStyle={ true }
							tooltipText={ __( 'Importing a remote site requires an internet connection.' ) }
						>
							{ __( 'Pull site' ) }
						</ConnectButton>
					</div>
				</SiteSyncDescription>
			) }

			{ isModalOpen && (
				<SyncSitesModalSelector
					mode={ modalState.mode || 'connect' }
					isLoading={ isFetching }
					onRequestClose={ () => {
						dispatch( connectedSitesActions.closeModal() );
						setModalState( ( prev ) => ( { ...prev, mode: null } ) );
					} }
					syncSites={ syncSites }
					onInitialRender={ refetchSites }
					onConnect={ async ( siteId: number ) => {
						const currentMode = modalState.mode;

						// Use unified handler with appropriate callback based on mode
						if ( currentMode === 'push' || currentMode === 'pull' ) {
							await handleSiteSelection( siteId, ( site ) => {
								setModalState( ( prev ) => ( {
									...prev,
									selectedRemoteSite: site,
									syncDialogType: currentMode,
								} ) );
							} );
						} else {
							await handleSiteSelection( siteId );
						}
					} }
					selectedSite={ selectedSite }
				/>
			) }

			{ modalState.syncDialogType && modalState.selectedRemoteSite && (
				<SyncDialog
					type={ modalState.syncDialogType }
					localSite={ selectedSite }
					remoteSite={ modalState.selectedRemoteSite }
					onPush={ ( tree ) => {
						const pushOptions = convertTreeToPushOptions( tree );
						void pushSite( modalState.selectedRemoteSite!, selectedSite, pushOptions );
						setModalState( ( prev ) => ( {
							...prev,
							syncDialogType: null,
							selectedRemoteSite: null,
						} ) );
					} }
					onPull={ ( tree ) => {
						const pullOptions = convertTreeToPullOptions( tree );
						pullSite( modalState.selectedRemoteSite!, selectedSite, pullOptions );
						setModalState( ( prev ) => ( {
							...prev,
							syncDialogType: null,
							selectedRemoteSite: null,
						} ) );
					} }
					onRequestClose={ () => {
						setModalState( ( prev ) => ( {
							...prev,
							syncDialogType: null,
							selectedRemoteSite: null,
						} ) );
					} }
				/>
			) }
		</div>
	);
}
