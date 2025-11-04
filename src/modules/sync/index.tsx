import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useEffect, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
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
import { useSyncSites } from 'src/hooks/sync-sites';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

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
						'Launch your site to push changes to a remote site, or import a remote site to pull changes locally.'
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Push and pull changes from your live site.' ),
						__( 'Connect multiple environments.' ),
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
	const isOffline = useOffline();

	const [ modalMode, setModalMode ] = useState< 'push' | 'pull' | 'connect' | null >( null );
	const [ syncDialogType, setSyncDialogType ] = useState< 'push' | 'pull' | null >( null );
	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | null >( null );

	const { isAuthenticated } = useAuth();

	useEffect( () => {
		if ( isAuthenticated ) {
			void refetchSites();
		}
	}, [ isAuthenticated, refetchSites ] );

	if ( ! isAuthenticated ) {
		return <NoAuthSyncTab />;
	}

	const handleConnect = async ( newConnectedSite: SyncSite ): Promise< SyncSite > => {
		try {
			await connectSite( newConnectedSite );
			// After connecting, reload connected sites to get the full site data
			await dispatch( loadAllConnectedSites() );
			// Get the updated connected sites from the store
			const updatedConnectedSites = await getIpcApi().getConnectedWpcomSites( selectedSite.id );
			// Find the site we just connected (it will have more metadata like localSiteId)
			const connectedSite = updatedConnectedSites.find( ( site ) => site.id === newConnectedSite.id );
			// Return the connected site with full metadata, or fallback to the original site
			return connectedSite || newConnectedSite;
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to connect to site' ),
				message: __( 'Please try again.' ),
			} );
			throw error;
		}
	};

	const handleLaunchSite = () => {
		setModalMode( 'push' );
		dispatch( connectedSitesActions.openModal() );
	};

	const handleImportSite = () => {
		setModalMode( 'pull' );
		dispatch( connectedSitesActions.openModal() );
	};

	const handleSiteSelected = async ( siteId: number ) => {
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
			// Connect the site first
			try {
				siteToUse = await handleConnect( selectedSiteFromList );
			} catch ( error ) {
				return; // Error already handled in handleConnect
			}
		} else {
			// Use the already connected site (it has more metadata)
			siteToUse = connectedSites.find( ( site ) => site.id === siteId ) || selectedSiteFromList;
		}

		// Close the modal
		dispatch( connectedSitesActions.closeModal() );
		setModalMode( null );

		// Open the appropriate sync dialog
		if ( modalMode === 'push' ) {
			setSelectedRemoteSite( siteToUse );
			setSyncDialogType( 'push' );
		} else if ( modalMode === 'pull' ) {
			setSelectedRemoteSite( siteToUse );
			setSyncDialogType( 'pull' );
		}
	};

	const handleConnectLegacy = async ( siteId: number ) => {
		const disconnectSiteId =
			typeof isModalOpen === 'object' ? isModalOpen.disconnectSiteId : undefined;

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
		await handleConnect( newConnectedSite );
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
						<div className="flex gap-4">
							<Tooltip
								disabled={ ! isOffline }
								icon={ offlineIcon }
								text={ __( 'Launching your site requires an internet connection.' ) }
								placement="top-start"
							>
								<Button
									variant="primary"
									onClick={ handleLaunchSite }
									disabled={ isOffline }
									aria-disabled={ isOffline }
								>
									{ __( 'Launch your site' ) }
								</Button>
							</Tooltip>
							<Tooltip
								disabled={ ! isOffline }
								icon={ offlineIcon }
								text={ __( 'Importing a remote site requires an internet connection.' ) }
								placement="top-start"
							>
								<Button
									variant="secondary"
									onClick={ handleImportSite }
									disabled={ isOffline }
									aria-disabled={ isOffline }
									className="!text-a8c-blue-50 !shadow-a8c-blue-50"
								>
									{ __( 'Import your remote site' ) }
								</Button>
							</Tooltip>
						</div>
					</div>
				</div>
			) : (
				<SiteSyncDescription>
					<div className="mt-8 flex gap-4">
						<Tooltip
							disabled={ ! isOffline }
							icon={ offlineIcon }
							text={ __( 'Launching your site requires an internet connection.' ) }
							placement="top-start"
						>
							<Button
								variant="primary"
								onClick={ handleLaunchSite }
								disabled={ isOffline }
								aria-disabled={ isOffline }
							>
								{ __( 'Launch your site' ) }
							</Button>
						</Tooltip>
						<Tooltip
							disabled={ ! isOffline }
							icon={ offlineIcon }
							text={ __( 'Importing a remote site requires an internet connection.' ) }
							placement="top-start"
						>
							<Button
								variant="secondary"
								onClick={ handleImportSite }
								disabled={ isOffline }
								aria-disabled={ isOffline }
								className="!text-a8c-blue-50 !shadow-a8c-blue-50"
							>
								{ __( 'Import your remote site' ) }
							</Button>
						</Tooltip>
					</div>
				</SiteSyncDescription>
			) }

			{ isModalOpen && (
				<SyncSitesModalSelector
					mode={ modalMode || 'connect' }
					isLoading={ isFetching }
					onRequestClose={ () => {
						dispatch( connectedSitesActions.closeModal() );
						setModalMode( null );
					} }
					syncSites={ syncSites }
					onInitialRender={ refetchSites }
					onConnect={ modalMode ? handleSiteSelected : handleConnectLegacy }
					selectedSite={ selectedSite }
				/>
			) }

			{ syncDialogType && selectedRemoteSite && (
				<SyncDialog
					type={ syncDialogType }
					localSite={ selectedSite }
					remoteSite={ selectedRemoteSite }
					onPush={ ( tree ) => {
						const pushOptions = convertTreeToPushOptions( tree );
						void pushSite( selectedRemoteSite, selectedSite, pushOptions );
						setSyncDialogType( null );
						setSelectedRemoteSite( null );
					} }
					onPull={ ( tree ) => {
						const pullOptions = convertTreeToPullOptions( tree );
						pullSite( selectedRemoteSite, selectedSite, pullOptions );
						setSyncDialogType( null );
						setSelectedRemoteSite( null );
					} }
					onRequestClose={ () => {
						setSyncDialogType( null );
						setSelectedRemoteSite( null );
					} }
				/>
			) }
		</div>
	);
}
