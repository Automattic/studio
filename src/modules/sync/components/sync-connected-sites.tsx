import { Icon } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { cloudUpload, cloudDownload, info, close, error } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { ClearAction } from 'src/components/clear-action';
import { CircleRedCrossIcon } from 'src/components/icons/circle-red-cross';
import offlineIcon from 'src/components/offline-icon';
import { PressableLogo } from 'src/components/pressable-logo';
import ProgressBar from 'src/components/progress-bar';
import { Tooltip, DynamicTooltip } from 'src/components/tooltip';
import { WordPressLogoCircle } from 'src/components/wordpress-logo-circle';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useAuth } from 'src/hooks/use-auth';
import { useImportExport } from 'src/hooks/use-import-export';
import { useOffline } from 'src/hooks/use-offline';
import { useSyncStatesProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import {
	pushBackupIsUploading,
	canCancelPull,
	canCancelPush,
} from 'src/lib/active-sync-operations';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { EnvironmentBadge } from 'src/modules/sync/components/environment-badge';
import { SyncDialog } from 'src/modules/sync/components/sync-dialog';
import {
	convertTreeToPullOptions,
	convertTreeToPushOptions,
} from 'src/modules/sync/lib/convert-tree-to-sync-options';
import { getSiteEnvironment } from 'src/modules/sync/lib/environment-utils';
import { useAppDispatch, useI18nLocale } from 'src/stores';
import {
	connectedSitesActions,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import type { SyncSite } from 'src/modules/sync/types';

const SyncConnectedSiteControls = ( {
	connectedSite,
	selectedSite,
}: {
	connectedSite: SyncSite;
	selectedSite: SiteDetails;
} ) => {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const [ syncDialogType, setSyncDialogType ] = useState< 'pull' | 'push' | null >( null );
	const {
		pullSite,
		isAnySitePulling,
		isAnySitePushing,
		pushSite,
		isSiteIdPulling,
		isSiteIdPushing,
		getLastSyncTimeText,
	} = useSyncSites();
	const { user } = useAuth();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const isAnyConnectedSiteSyncing = connectedSites.some(
		( site ) =>
			isSiteIdPulling( selectedSite.id, site.id ) || isSiteIdPushing( selectedSite.id, site.id )
	);
	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;

	return (
		<Tooltip
			disabled={ ! isOffline }
			icon={ offlineIcon }
			text={ __( 'Pulling or pushing a site requires an internet connection.' ) }
			placement="top-start"
		>
			<div className="flex gap-2 h-5">
				{ isAnySiteSyncing ? (
					<Tooltip
						text={
							isAnyConnectedSiteSyncing
								? __(
										'This Studio site is syncing. Please wait for the sync to finish before you pull it.'
								  )
								: __(
										'Another Studio site is syncing. Please wait for the sync to finish before you pull this site.'
								  )
						}
						placement="top-start"
					>
						<Button variant="link" disabled={ true }>
							<Icon icon={ cloudDownload } />
							{ __( 'Pull' ) }
						</Button>
					</Tooltip>
				) : (
					<DynamicTooltip
						getTooltipText={ () => getLastSyncTimeText( connectedSite.lastPullTimestamp, 'pull' ) }
						placement="top-start"
						disabled={ isOffline }
					>
						<Button
							variant="link"
							className={ cx(
								! isOffline &&
									! isAnySitePulling &&
									! isAnySitePushing &&
									'!text-black hover:!text-a8c-blue-50'
							) }
							onClick={ () => setSyncDialogType( 'pull' ) }
							disabled={ isAnySiteSyncing || isOffline }
						>
							<Icon icon={ cloudDownload } />
							{ __( 'Pull' ) }
						</Button>
					</DynamicTooltip>
				) }
				{ isAnySiteSyncing ? (
					<Tooltip
						text={
							isAnyConnectedSiteSyncing
								? __(
										'This Studio site is syncing. Please wait for the sync to finish before you push it.'
								  )
								: __(
										'Another Studio site is syncing. Please wait for the sync to finish before you push this site.'
								  )
						}
						placement="top-start"
					>
						<Button variant="link" disabled={ true }>
							<Icon icon={ cloudUpload } />
							{ __( 'Push' ) }
						</Button>
					</Tooltip>
				) : (
					<DynamicTooltip
						getTooltipText={ () => getLastSyncTimeText( connectedSite.lastPushTimestamp, 'push' ) }
						placement="top-start"
						disabled={ isOffline }
					>
						<Button
							variant="link"
							className={ cx(
								! isOffline &&
									! isAnySitePulling &&
									! isAnySitePushing &&
									'!text-black hover:!text-a8c-blue-50'
							) }
							onClick={ () => setSyncDialogType( 'push' ) }
							disabled={ isAnySiteSyncing || isOffline }
						>
							<Icon icon={ cloudUpload } />
							{ __( 'Push' ) }
						</Button>
					</DynamicTooltip>
				) }
				{ syncDialogType && (
					<SyncDialog
						type={ syncDialogType }
						localSite={ selectedSite }
						remoteSite={ connectedSite }
						onPush={ ( tree ) => {
							const pushOptions = convertTreeToPushOptions( tree );
							void pushSite( connectedSite, selectedSite, pushOptions );
						} }
						onPull={ ( tree ) => {
							const pullOptions = convertTreeToPullOptions( tree );
							pullSite( connectedSite, selectedSite, pullOptions );
						} }
						onRequestClose={ () => setSyncDialogType( null ) }
					/>
				) }
			</div>
		</Tooltip>
	);
};

type SyncConnectedSitesListProps = {
	selectedSite: SiteDetails;
	connectedSite: SyncSite;
};

const SyncConnectedSitesSectionItem = ( {
	selectedSite,
	connectedSite,
}: SyncConnectedSitesListProps ) => {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const { clearPullState, getPullState, getPushState, clearPushState, cancelPull, cancelPush } =
		useSyncSites();
	const { importState } = useImportExport();
	const {
		isKeyPulling,
		isKeyPushing,
		isKeyFinished,
		isKeyFailed,
		isKeyCancelled,
		getPullStatusWithProgress,
		getPushUploadPercentage,
		getPushUploadMessage,
		isKeyUploadingPaused,
	} = useSyncStatesProgressInfo();

	const sitePullState = getPullState( selectedSite.id, connectedSite.id );
	const isPulling = sitePullState && isKeyPulling( sitePullState.status.key );
	const isPullError = sitePullState && isKeyFailed( sitePullState.status.key );
	const hasPullFinished = sitePullState && isKeyFinished( sitePullState.status.key );
	const hasPullCancelled = sitePullState && isKeyCancelled( sitePullState.status.key );
	const { message: sitePullStatusMessage, progress: sitePullStatusProgress } =
		getPullStatusWithProgress( sitePullState?.status, importState[ connectedSite.localSiteId ] );

	const pushState = getPushState( selectedSite.id, connectedSite.id );
	const isPushing = pushState && isKeyPushing( pushState.status.key );
	const isUploadingPaused = pushState && isKeyUploadingPaused( pushState.status.key );
	const isPushError = pushState && isKeyFailed( pushState.status.key );
	const hasPushFinished = pushState && isKeyFinished( pushState.status.key );
	const hasPushCancelled = pushState && isKeyCancelled( pushState.status.key );

	const uploadPercentage = getPushUploadPercentage(
		pushState?.status.key,
		pushState?.uploadProgress
	);

	const getPushProgressTooltip = () => {
		if ( isOffline ) {
			return __(
				"Your internet connection appears to be offline. Sync will continue running remotely. We will send you an email once it's completed."
			);
		}
		if ( pushBackupIsUploading( pushState?.status.key ) ) {
			return __( 'Push is in progress. We will send you an email when it is completed.' );
		}
		return __(
			"The push is in progress and will continue running remotely. We will send you an email once it's completed."
		);
	};

	return (
		<div className="grid grid-cols-[max-content_1fr_max-content]">
			<div
				className="col-span-3 grid px-8 gap-2 justify-items-start items-center grid-cols-subgrid"
				key={ connectedSite.id }
			>
				<div className="shrink-0">
					<EnvironmentBadge type={ getSiteEnvironment( connectedSite ) } />
				</div>

				<Button
					variant="link"
					className="!text-a8c-gray-70 hover:!text-a8c-blue-50 max-w-full overflow-hidden"
					onClick={ () => {
						getIpcApi().openURL( connectedSite.url );
					} }
				>
					<span className="truncate">{ connectedSite.url.replace( /^https?:\/\//, '' ) }</span>{ ' ' }
					<ArrowIcon />
				</Button>

				<div className="flex shrink-0 justify-self-end">
					{ isPulling && (
						<div className="flex items-center gap-2 max-w-full">
							<div className="flex flex-col gap-2 min-w-44 flex-shrink">
								<div className="a8c-body-small">{ sitePullStatusMessage }</div>
								<ProgressBar value={ sitePullStatusProgress } maxValue={ 100 } />
							</div>
							<Tooltip
								text={
									canCancelPull( sitePullState?.status.key )
										? __( 'Cancel pull' )
										: __( 'Pull can not be cancelled while importing changes to your local site' )
								}
								placement="top-start"
							>
								<Button
									variant="link"
									onClick={ () => cancelPull( selectedSite.id, connectedSite.id ) }
									disabled={ ! canCancelPull( sitePullState?.status.key ) }
									className="!p-0 flex-shrink-0"
								>
									<Icon icon={ close } size={ 20 } />
								</Button>
							</Tooltip>
						</div>
					) }
					{ sitePullState?.status && hasPullCancelled && (
						<ClearAction onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }>
							{ __( 'Pull cancelled' ) }
						</ClearAction>
					) }
					{ isPullError && (
						<ClearAction
							onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }
							isError
						>
							{ __( 'Error pulling changes' ) }
						</ClearAction>
					) }
					{ isPushError && (
						<ClearAction
							onClick={ () => clearPushState( selectedSite.id, connectedSite.id ) }
							isError
						>
							{ __( 'Error pushing changes' ) }
						</ClearAction>
					) }
					{ hasPullFinished && (
						<ClearAction onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }>
							{ __( 'Pull complete' ) }
						</ClearAction>
					) }
					{ pushState?.status && isUploadingPaused && (
						<Tooltip
							text={ __(
								'The site uploading has been paused due to an internet connection issue. We will retry automatically in a few seconds.'
							) }
							placement="top-start"
						>
							<Button variant="link" disabled={ true }>
								<Icon icon={ error } />
								{ pushState.status.message }
							</Button>
						</Tooltip>
					) }
					{ pushState?.status && isPushing && (
						<div className="flex items-center gap-2 max-w-full">
							<Tooltip text={ getPushProgressTooltip() } placement="top-start">
								<div className="flex flex-col gap-2 min-w-44 flex-shrink">
									<div className="a8c-body-small flex items-center gap-0.5">
										{ isOffline ? (
											<Icon icon={ offlineIcon } size={ 12 } className="fill-a8c-gray-70" />
										) : (
											<Icon icon={ info } size={ 14 } />
										) }
										{ getPushUploadMessage( pushState.status.message, uploadPercentage ) }
									</div>
									<ProgressBar value={ pushState.status.progress } maxValue={ 100 } />
								</div>
							</Tooltip>
							<Tooltip
								text={
									canCancelPush( pushState?.status.key )
										? __( 'Cancel push' )
										: __( 'Push can not be cancelled while applying changes to the remote site' )
								}
								placement="top-start"
							>
								<Button
									variant="link"
									onClick={ () => cancelPush( selectedSite.id, connectedSite.id ) }
									disabled={ ! canCancelPush( pushState?.status.key ) }
									className="!p-0 flex-shrink-0"
								>
									<Icon icon={ close } size={ 20 } />
								</Button>
							</Tooltip>
						</div>
					) }
					{ pushState?.status && hasPushCancelled && (
						<ClearAction onClick={ () => clearPushState( selectedSite.id, connectedSite.id ) }>
							{ __( 'Push cancelled' ) }
						</ClearAction>
					) }

					{ pushState?.status && hasPushFinished && (
						<ClearAction onClick={ () => clearPushState( selectedSite.id, connectedSite.id ) }>
							{ pushState.status.message }
						</ClearAction>
					) }
					{ ! isPulling &&
						! hasPullFinished &&
						! isPullError &&
						! isPushError &&
						! isPushing &&
						! isUploadingPaused &&
						! hasPushFinished &&
						! hasPullCancelled &&
						! hasPushCancelled && (
							<SyncConnectedSiteControls
								connectedSite={ connectedSite }
								selectedSite={ selectedSite }
							/>
						) }
				</div>
			</div>
		</div>
	);
};

type SyncConnectedSiteSectionProps = {
	connectedSite: SyncSite;
	disconnectSite: ( id: number ) => void;
	selectedSite: SiteDetails;
};

const SyncConnectedSiteSection = ( {
	connectedSite,
	disconnectSite,
	selectedSite,
}: SyncConnectedSiteSectionProps ) => {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const locale = useI18nLocale();
	const { clearPullState, isSiteIdPulling, isSiteIdPushing } = useSyncSites();
	const isOffline = useOffline();

	const handleDisconnectSite = async () => {
		const dontShowDisconnectWarning = localStorage.getItem( 'dontShowDisconnectWarning' );
		if ( ! dontShowDisconnectWarning ) {
			const CANCEL_BUTTON_INDEX = 1;
			const DISCONNECT_BUTTON_INDEX = 0;

			const disconnectMessage = connectedSite.name
				? sprintf( __( 'Disconnect %s' ), connectedSite.name )
				: __( 'Disconnect site' );

			const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
				message: disconnectMessage,
				detail: __(
					'Your WordPress.com site will not be affected by disconnecting it from Studio.'
				),
				buttons: [ __( 'Disconnect' ), __( 'Cancel' ) ],
				cancelId: CANCEL_BUTTON_INDEX,
				checkboxLabel: __( "Don't ask again" ),
			} );

			if ( response === DISCONNECT_BUTTON_INDEX ) {
				if ( checkboxChecked ) {
					localStorage.setItem( 'dontShowDisconnectWarning', 'true' );
				}
				disconnectSite( connectedSite.id );
				clearPullState( selectedSite.id, connectedSite.id );
			}
		} else {
			disconnectSite( connectedSite.id );
		}
	};

	const hasConnectionErrors = connectedSite?.syncSupport !== 'already-connected';
	const isPulling = isSiteIdPulling( selectedSite.id, connectedSite.id );
	const isPushing = isSiteIdPushing( selectedSite.id, connectedSite.id );

	let logo = <WordPressLogoCircle />;
	if ( hasConnectionErrors ) {
		logo = <CircleRedCrossIcon />;
	} else if ( connectedSite.isPressable ) {
		logo = <PressableLogo />;
	}

	return (
		<div key={ connectedSite.id } className="flex flex-col gap-2 border-b border-a8c-gray-0 py-5">
			<div className="flex items-center gap-2 px-8">
				{ logo }
				<div className={ cx( 'a8c-label-semibold', hasConnectionErrors && 'error-message' ) }>
					{ connectedSite.name }
				</div>
				<div className="ms-auto">
					<Tooltip
						text={ __(
							'This site is syncing. Please wait for the sync to finish before you can disconnect it.'
						) }
						disabled={ ! ( isPulling || isPushing ) || isOffline }
						placement="top-start"
					>
						<Button
							variant="link"
							className={ cx(
								! isPulling && ! isPushing ? '!text-a8c-gray-70 hover:!text-a8c-red-50' : ''
							) }
							onClick={ handleDisconnectSite }
							disabled={ isPulling || isPushing }
						>
							{ __( 'Disconnect' ) }
						</Button>
					</Tooltip>
				</div>
			</div>

			{ hasConnectionErrors && (
				<div className="flex items-center px-8">
					<div className="text-[#3C434A]">
						{ createInterpolateElement(
							__(
								'<siteUrlButton /> appears to be deleted or is currently unreachable. <button>Get help ↗</button>'
							),
							{
								button: (
									<Button
										variant="link"
										onClick={ () => getIpcApi().openURL( getLocalizedLink( locale, 'docsSync' ) ) }
									/>
								),
								siteUrlButton: (
									<Button
										variant="link"
										onClick={ () => {
											getIpcApi().openURL( connectedSite.url );
										} }
									>
										<span className="truncate">
											{ connectedSite.url.replace( /^https?:\/\//, '' ) }
										</span>
									</Button>
								),
							}
						) }
					</div>
					<Button
						onClick={ () => {
							disconnectSite( connectedSite.id );
							dispatch( connectedSitesActions.openModal() );
						} }
						variant="primary"
						className="ms-auto"
					>
						{ __( 'Reconnect' ) }
					</Button>
				</div>
			) }

			{ ! hasConnectionErrors && (
				<SyncConnectedSitesSectionItem
					selectedSite={ selectedSite }
					connectedSite={ connectedSite }
				/>
			) }
		</div>
	);
};

export function SyncConnectedSites( {
	connectedSites,
	disconnectSite,
	selectedSite,
}: {
	connectedSites: SyncSite[];
	disconnectSite: ( id: number ) => void;
	selectedSite: SiteDetails;
} ) {
	return (
		<div className="flex flex-col flex-1 pt-8">
			{ connectedSites.map( ( connectedSite ) => (
				<SyncConnectedSiteSection
					key={ connectedSite.id }
					connectedSite={ connectedSite }
					selectedSite={ selectedSite }
					disconnectSite={ disconnectSite }
				/>
			) ) }
		</div>
	);
}
