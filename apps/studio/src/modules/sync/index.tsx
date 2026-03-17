import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { CpanelConnectedSite } from 'src/modules/cpanel/components/cpanel-connected-site';
import { CpanelCredentialsModal } from 'src/modules/cpanel/components/cpanel-credentials-modal';
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
import { useGetCpanelSitesForLocalSiteQuery } from 'src/stores/cpanel/cpanel-connected-sites';
import { syncOperationsThunks } from 'src/stores/sync';
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

export function ContentTabSync( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const isModalOpen = useRootSelector( connectedSitesSelectors.selectIsModalOpen );
	const reduxModalMode = useRootSelector( connectedSitesSelectors.selectModalMode );
	const selectedRemoteSiteId = useRootSelector(
		connectedSitesSelectors.selectSelectedRemoteSiteId
	);
	const selectedLocalSiteId = useRootSelector( connectedSitesSelectors.selectSelectedLocalSiteId );
	const { isAuthenticated, user, client } = useAuth();
	const { data: connectedSites = [], isLoading: isLoadingConnectedSites } =
		useGetConnectedSitesForLocalSiteQuery( {
			localSiteId: selectedSite.id,
			userId: user?.id,
		} );
	const [ connectSite ] = useConnectSiteMutation();
	const [ disconnectSite ] = useDisconnectSiteMutation();

	const [ showCpanelModal, setShowCpanelModal ] = useState( false );
	const { data: cpanelSites = [] } = useGetCpanelSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
	} );

	const connectedSiteIds = connectedSites.map( ( { id } ) => id );
	const { data: syncSites = [] } = useGetWpComSitesQuery( {
		connectedSiteIds,
		userId: user?.id,
	} );

	const [ selectedRemoteSite, setSelectedRemoteSite ] = useState< SyncSite | null >( null );

	// Derived inline from Redux + connectedSites (storage) rather than stored in local state.
	// Local state would reset on remount — SiteContentTabs causes a second TabPanel remount
	// on programmatic tab changes, which would lose the value before the dialog could open.
	// connectedSites is used instead of syncSites because the /me/sites?filter=atomic,wpcom
	// endpoint excludes some site types (e.g. Pressable) that can still be connected.
	const deepLinkRemoteSite =
		selectedRemoteSiteId && selectedLocalSiteId === selectedSite.id
			? connectedSites.find( ( site ) => site.id === selectedRemoteSiteId ) ?? null
			: null;

	const effectiveRemoteSite = deepLinkRemoteSite || selectedRemoteSite;

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

	const hasAnyConnections = connectedSites.length > 0 || cpanelSites.length > 0;

	return (
		<div className="flex flex-col h-full overflow-y-auto">
			{ hasAnyConnections ? (
				<div className="h-full relative">
					{ connectedSites.length > 0 && (
						<SyncConnectedSites
							connectedSites={ connectedSites }
							selectedSite={ selectedSite }
							disconnectSite={ ( id ) =>
								disconnectSite( { siteId: id, localSiteId: selectedSite.id } )
							}
						/>
					) }
					{ cpanelSites.map( ( cpanelSite ) => (
						<CpanelConnectedSite
							key={ cpanelSite.id }
							cpanelSite={ cpanelSite }
							selectedSite={ selectedSite }
						/>
					) ) }
					<div className="sticky bottom-0 bg-white/[0.8] backdrop-blur-sm w-full px-8 py-6 mt-auto flex gap-3">
						<ConnectButton
							variant="primary"
							connectSite={ () => dispatch( connectedSitesActions.openModal( 'connect' ) ) }
						>
							{ __( 'Connect WordPress.com site' ) }
						</ConnectButton>
						<ConnectButton variant="secondary" connectSite={ () => setShowCpanelModal( true ) }>
							{ __( 'Connect cPanel site' ) }
						</ConnectButton>
					</div>
				</div>
			) : isLoadingConnectedSites ? null : (
				<SiteSyncDescription>
					<div className="mt-8 flex gap-3">
						<ConnectButton
							variant="primary"
							connectSite={ () => dispatch( connectedSitesActions.openModal( 'connect' ) ) }
						>
							{ __( 'Connect WordPress.com site' ) }
						</ConnectButton>
						<ConnectButton variant="secondary" connectSite={ () => setShowCpanelModal( true ) }>
							{ __( 'Connect cPanel site' ) }
						</ConnectButton>
					</div>
				</SiteSyncDescription>
			) }

			{ showCpanelModal && (
				<CpanelCredentialsModal
					localSiteId={ selectedSite.id }
					onClose={ () => setShowCpanelModal( false ) }
					onConnected={ () => setShowCpanelModal( false ) }
				/>
			) }

			{ isModalOpen && ! effectiveRemoteSite && (
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

			{ effectiveRemoteSite &&
				( deepLinkRemoteSite || ( reduxModalMode && reduxModalMode !== 'connect' ) ) && (
					<SyncDialog
						type={ deepLinkRemoteSite ? 'push' : ( reduxModalMode as 'push' | 'pull' ) }
						localSite={ selectedSite }
						remoteSite={ effectiveRemoteSite }
						onPush={ async ( tree ) => {
							await handleConnect( effectiveRemoteSite );
							const pushOptions = convertTreeToPushOptions( tree );
							void dispatch(
								syncOperationsThunks.pushSite( {
									connectedSite: effectiveRemoteSite,
									selectedSite,
									options: pushOptions,
								} )
							);
						} }
						onPull={ async ( tree ) => {
							if ( ! client ) {
								return;
							}
							await handleConnect( effectiveRemoteSite );
							const pullOptions = convertTreeToPullOptions( tree );
							void dispatch(
								syncOperationsThunks.pullSite( {
									client,
									connectedSite: effectiveRemoteSite,
									selectedSite,
									options: pullOptions,
								} )
							);
						} }
						onRequestClose={ () => {
							if ( deepLinkRemoteSite ) {
								dispatch( connectedSitesActions.clearSelectedRemoteSiteId() );
							} else {
								setSelectedRemoteSite( null );
								dispatch( connectedSitesActions.closeModal() );
							}
						} }
					/>
				) }
		</div>
	);
}
