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
import { PauseIcon } from 'src/components/icons/pause';
import { PlayIcon } from 'src/components/icons/play';
import offlineIcon from 'src/components/offline-icon';
import { PressableLogo } from 'src/components/pressable-logo';
import ProgressBar from 'src/components/progress-bar';
import { Tooltip, DynamicTooltip } from 'src/components/tooltip';
import { WordPressLogoCircle } from 'src/components/wordpress-logo-circle';
import { useLastSyncTimeText } from 'src/hooks/sync-sites/use-last-sync-time-text';
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
import { useAppDispatch, useI18nLocale, useRootSelector } from 'src/stores';
import {
	syncOperationsSelectors,
	syncOperationsThunks,
	syncOperationsActions,
} from 'src/stores/sync';
import {
	connectedSitesActions,
	connectedSitesSelectors,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import type { SyncSite } from '@studio/common/types/sync';

const SyncConnectedSiteControls = ( {
	connectedSite,
	selectedSite,
}: {
	connectedSite: SyncSite;
	selectedSite: SiteDetails;
} ) => {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const dispatch = useAppDispatch();
	const [ syncDialogType, setSyncDialogType ] = useState< 'pull' | 'push' | null >( null );
	const getLastSyncTimeText = useLastSyncTimeText();
	const { user, client } = useAuth();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const isAnyConnectedSiteDoingLocalSyncWork = useRootSelector( ( state ) =>
		connectedSites.some( ( site ) =>
			syncOperationsSelectors.selectIsSiteDoingLocalSyncWork( selectedSite.id, site.id )( state )
		)
	);
	const isAnySiteDoingLocalSyncWork = useRootSelector(
		syncOperationsSelectors.selectIsAnySiteDoingLocalSyncWork
	);

	return (
		<Tooltip
			disabled={ ! isOffline }
			icon={ offlineIcon }
			text={ __( 'Pulling or pushing a site requires an internet connection.' ) }
			placement="top-start"
		>
			<div className="flex gap-2 h-5">
				{ isAnySiteDoingLocalSyncWork ? (
					<Tooltip
						text={
							isAnyConnectedSiteDoingLocalSyncWork
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
									! isAnySiteDoingLocalSyncWork &&
									'!text-frame-text hover:!text-frame-theme'
							) }
							onClick={ () => setSyncDialogType( 'pull' ) }
							disabled={ isAnySiteDoingLocalSyncWork || isOffline }
							data-testid="sync-list-pull-button"
						>
							<Icon icon={ cloudDownload } />
							{ __( 'Pull' ) }
						</Button>
					</DynamicTooltip>
				) }
				{ isAnySiteDoingLocalSyncWork ? (
					<Tooltip
						text={
							isAnyConnectedSiteDoingLocalSyncWork
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
									! isAnySiteDoingLocalSyncWork &&
									'!text-frame-text hover:!text-frame-theme'
							) }
							onClick={ () => setSyncDialogType( 'push' ) }
							disabled={ isAnySiteDoingLocalSyncWork || isOffline }
							data-testid="sync-list-push-button"
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
							void dispatch(
								syncOperationsThunks.pushSite( {
									connectedSite,
									selectedSite,
									options: pushOptions,
								} )
							);
						} }
						onPull={ ( tree ) => {
							if ( ! client ) {
								return;
							}
							const pullOptions = convertTreeToPullOptions( tree );
							void dispatch(
								syncOperationsThunks.pullSite( {
									client,
									connectedSite,
									selectedSite,
									options: pullOptions,
								} )
							);
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
	const dispatch = useAppDispatch();
	const isOffline = useOffline();
	const isSiteLoading = useRootSelector(
		connectedSitesSelectors.selectIsLoadingSiteId( connectedSite.id )
	);
	const getLastSyncTimeText = useLastSyncTimeText();
	const { importState, clearImportState } = useImportExport();
	const { getPushUploadPercentage, getPushUploadMessage } = useSyncStatesProgressInfo();

	const sitePullState = useRootSelector(
		syncOperationsSelectors.selectPullState( selectedSite.id, connectedSite.id )
	);
	const isPulling =
		sitePullState?.status.key === 'in-progress' ||
		sitePullState?.status.key === 'downloading' ||
		sitePullState?.status.key === 'importing';
	const isPullError = sitePullState?.status.key === 'failed';
	const hasPullFinished = sitePullState?.status.key === 'finished';
	const hasPullCancelled = sitePullState?.status.key === 'cancelled';
	const pullImportState = importState[ connectedSite.localSiteId ];
	let sitePullStatusMessage = '';
	let sitePullStatusProgress = 0;
	if ( pullImportState ) {
		if ( pullImportState.progress === 100 ) {
			sitePullStatusMessage = __( 'Applying final details…' );
			sitePullStatusProgress = 99;
		} else {
			sitePullStatusMessage = pullImportState.statusMessage;
			// Map import progress (0-100%) to the pull importing range (80-100%)
			sitePullStatusProgress = 80 + 20 * ( pullImportState.progress / 100 );
		}
	} else if ( sitePullState?.status ) {
		sitePullStatusMessage = sitePullState.status.message;
		sitePullStatusProgress = sitePullState.status.progress;
	}

	const pushState = useRootSelector(
		syncOperationsSelectors.selectPushState( selectedSite.id, connectedSite.id )
	);
	const isPushing =
		pushState?.status.key === 'creatingBackup' ||
		pushState?.status.key === 'uploading' ||
		pushState?.status.key === 'creatingRemoteBackup' ||
		pushState?.status.key === 'applyingChanges' ||
		pushState?.status.key === 'finishing';
	const isUploading = pushState?.status.key === 'uploading';
	const isUploadingManuallyPaused = pushState?.status.key === 'uploadingManuallyPaused';
	const isUploadingNetworkPaused = pushState?.status.key === 'uploadingPaused';
	const isPushError = pushState?.status.key === 'failed';
	const hasPushFinished = pushState?.status.key === 'finished';
	const hasPushCancelled = pushState?.status.key === 'cancelled';

	const uploadPercentage = getPushUploadPercentage(
		pushState?.status.key,
		pushState?.uploadProgress
	);

	function clearPullState( selectedSiteId: string, remoteSiteId: number ) {
		clearImportState( selectedSiteId );
		dispatch(
			syncOperationsActions.clearPullState( {
				selectedSiteId,
				remoteSiteId,
			} )
		);
	}

	const getPushProgressTooltip = () => {
		if ( isOffline ) {
			return __(
				"You are currently offline. Sync will continue running remotely. We will send you an email once it's completed."
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
		<div className="grid grid-cols-[1fr_max-content]">
			<div
				className="col-span-2 grid ps-8 pe-5 gap-2 justify-items-start items-center grid-cols-subgrid"
				key={ connectedSite.id }
			>
				{ isSiteLoading ? (
					<div className="h-5 w-48 rounded skeleton-bg" aria-label={ __( 'Loading site URL' ) } />
				) : (
					<Button
						variant="link"
						className="!text-frame-text-secondary hover:!text-frame-theme max-w-full overflow-hidden"
						onClick={ () => {
							getIpcApi().openURL( connectedSite.url );
						} }
					>
						<span className="truncate">{ connectedSite.url.replace( /^https?:\/\//, '' ) }</span>{ ' ' }
						<ArrowIcon />
					</Button>
				) }

				<div className="flex shrink-0 justify-self-end justify-end items-center min-h-[26px] w-80">
					{ isPulling && (
						<div className="flex items-center gap-2 max-w-full transition-all duration-300 ease-in-out">
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
									variant="icon"
									onClick={ () =>
										dispatch(
											syncOperationsThunks.cancelPull( {
												selectedSiteId: selectedSite.id,
												remoteSiteId: connectedSite.id,
											} )
										)
									}
									disabled={ ! canCancelPull( sitePullState?.status.key ) }
									className="flex-shrink-0 transition-all duration-300 ease-in-out"
									aria-label={ __( 'Cancel pull' ) }
								>
									<span className="flex items-center justify-center w-5 h-5">
										<Icon icon={ close } size={ 20 } />
									</span>
								</Button>
							</Tooltip>
						</div>
					) }
					{ hasPullCancelled && (
						<div className="transition-all duration-300 ease-in-out">
							<ClearAction onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }>
								{ __( 'Pull cancelled' ) }
							</ClearAction>
						</div>
					) }
					{ isPullError && (
						<div className="transition-all duration-300 ease-in-out">
							<ClearAction
								onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }
								isError
							>
								{ __( 'Error pulling changes' ) }
							</ClearAction>
						</div>
					) }
					{ isPushError && (
						<div className="transition-all duration-300 ease-in-out">
							<ClearAction
								onClick={ () =>
									dispatch(
										syncOperationsActions.clearPushState( {
											selectedSiteId: selectedSite.id,
											remoteSiteId: connectedSite.id,
										} )
									)
								}
								isError
							>
								{ __( 'Error pushing changes' ) }
							</ClearAction>
						</div>
					) }
					{ hasPullFinished && (
						<div className="transition-all duration-300 ease-in-out">
							<DynamicTooltip
								getTooltipText={ () =>
									getLastSyncTimeText( connectedSite.lastPullTimestamp, 'pull' )
								}
								placement="top-start"
							>
								<ClearAction onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }>
									{ __( 'Pull complete' ) }
								</ClearAction>
							</DynamicTooltip>
						</div>
					) }
					{ isUploadingNetworkPaused && (
						<div className="transition-all duration-300 ease-in-out">
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
						</div>
					) }
					{ isUploadingManuallyPaused && (
						<div className="flex items-center gap-2 max-w-full transition-all duration-300 ease-in-out">
							<Tooltip
								text={ __(
									'Upload is manually paused. Click the resume button to continue uploading.'
								) }
								placement="top-start"
							>
								<div className="flex flex-col gap-2 min-w-44 flex-shrink">
									<div className="a8c-body-small flex items-center gap-0.5">
										<Icon icon={ info } size={ 14 } className="fill-frame-text-secondary" />
										{ pushState.status.message }
									</div>
									<ProgressBar value={ pushState.status.progress } maxValue={ 100 } />
								</div>
							</Tooltip>
							<Tooltip text={ __( 'Resume upload' ) } placement="top">
								<Button
									variant="icon"
									onClick={ () =>
										getIpcApi().resumeSyncUpload( selectedSite.id, connectedSite.id )
									}
									className="flex-shrink-0 transition-all duration-300 ease-in-out"
									aria-label={ __( 'Resume upload' ) }
								>
									<span className="flex items-center justify-center w-5 h-5">
										<PlayIcon />
									</span>
								</Button>
							</Tooltip>
							<Tooltip text={ __( 'Cancel push' ) } placement="top-start">
								<Button
									variant="icon"
									onClick={ () =>
										dispatch(
											syncOperationsThunks.cancelPush( {
												selectedSiteId: selectedSite.id,
												remoteSiteId: connectedSite.id,
											} )
										)
									}
									className="flex-shrink-0 transition-all duration-300 ease-in-out"
									aria-label={ __( 'Cancel push' ) }
								>
									<span className="flex items-center justify-center w-5 h-5">
										<Icon icon={ close } size={ 20 } />
									</span>
								</Button>
							</Tooltip>
						</div>
					) }
					{ isPushing && (
						<div className="flex items-center gap-2 max-w-full transition-all duration-300 ease-in-out">
							<Tooltip text={ getPushProgressTooltip() } placement="top-start">
								<div className="flex flex-col gap-2 min-w-44 flex-shrink">
									<div className="a8c-body-small flex items-center gap-0.5">
										{ isOffline ? (
											<Icon
												icon={ offlineIcon }
												size={ 12 }
												className="fill-frame-text-secondary"
											/>
										) : (
											<Icon icon={ info } size={ 14 } className="fill-frame-text-secondary" />
										) }
										{ getPushUploadMessage( pushState.status.message, uploadPercentage ) }
									</div>
									<ProgressBar value={ pushState.status.progress } maxValue={ 100 } />
								</div>
							</Tooltip>
							<div
								className={ cx(
									'flex-shrink-0 transition-opacity duration-300 ease-in-out',
									! isUploading || ( uploadPercentage !== null && uploadPercentage >= 100 )
										? 'opacity-0 pointer-events-none'
										: 'opacity-100'
								) }
							>
								<Tooltip text={ __( 'Pause upload' ) } placement="top">
									<Button
										variant="icon"
										onClick={ () =>
											getIpcApi().pauseSyncUpload( selectedSite.id, connectedSite.id )
										}
										className="flex-shrink-0"
										aria-label={ __( 'Pause upload' ) }
									>
										<span className="flex items-center justify-center w-5 h-5">
											<PauseIcon />
										</span>
									</Button>
								</Tooltip>
							</div>
							<Tooltip
								text={
									canCancelPush( pushState.status.key )
										? __( 'Cancel push' )
										: __( 'Push can not be cancelled while applying changes to the remote site' )
								}
								placement="top-start"
							>
								<Button
									variant="icon"
									onClick={ () =>
										dispatch(
											syncOperationsThunks.cancelPush( {
												selectedSiteId: selectedSite.id,
												remoteSiteId: connectedSite.id,
											} )
										)
									}
									disabled={ ! canCancelPush( pushState.status.key ) }
									className="flex-shrink-0 transition-all duration-300 ease-in-out"
									aria-label={ __( 'Cancel push' ) }
								>
									<span className="flex items-center justify-center w-5 h-5">
										<Icon icon={ close } size={ 20 } />
									</span>
								</Button>
							</Tooltip>
						</div>
					) }
					{ hasPushCancelled && (
						<div className="transition-all duration-300 ease-in-out">
							<ClearAction
								onClick={ () =>
									dispatch(
										syncOperationsActions.clearPushState( {
											selectedSiteId: selectedSite.id,
											remoteSiteId: connectedSite.id,
										} )
									)
								}
							>
								{ __( 'Push cancelled' ) }
							</ClearAction>
						</div>
					) }
					{ hasPushFinished && (
						<div className="transition-all duration-300 ease-in-out">
							<DynamicTooltip
								getTooltipText={ () =>
									getLastSyncTimeText( connectedSite.lastPushTimestamp, 'push' )
								}
								placement="top-start"
							>
								<ClearAction
									onClick={ () =>
										dispatch(
											syncOperationsActions.clearPushState( {
												selectedSiteId: selectedSite.id,
												remoteSiteId: connectedSite.id,
											} )
										)
									}
								>
									{ pushState.status.message }
								</ClearAction>
							</DynamicTooltip>
						</div>
					) }
					{ ! isPulling &&
						! hasPullFinished &&
						! isPullError &&
						! isPushError &&
						! isPushing &&
						! isUploadingNetworkPaused &&
						! isUploadingManuallyPaused &&
						! hasPushFinished &&
						! hasPullCancelled &&
						! hasPushCancelled && (
							<div className="transition-all duration-300 ease-in-out">
								<SyncConnectedSiteControls
									connectedSite={ connectedSite }
									selectedSite={ selectedSite }
								/>
							</div>
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
				void dispatch(
					syncOperationsActions.clearPullState( {
						selectedSiteId: selectedSite.id,
						remoteSiteId: connectedSite.id,
					} )
				);
			}
		} else {
			disconnectSite( connectedSite.id );
		}
	};

	const isSiteLoading = useRootSelector(
		connectedSitesSelectors.selectIsLoadingSiteId( connectedSite.id )
	);
	const hasConnectionErrors = connectedSite?.syncSupport !== 'already-connected';
	const isDoingLocalSyncWork = useRootSelector(
		syncOperationsSelectors.selectIsSiteDoingLocalSyncWork( selectedSite.id, connectedSite.id )
	);

	let logo = <WordPressLogoCircle />;
	if ( isSiteLoading ) {
		logo = <div className="w-5 h-5 rounded-full skeleton-bg" aria-label={ __( 'Loading' ) } />;
	} else if ( hasConnectionErrors ) {
		logo = <CircleRedCrossIcon />;
	} else if ( connectedSite.isPressable ) {
		logo = <PressableLogo />;
	}

	return (
		<div key={ connectedSite.id } className="flex flex-col gap-2 border-b border-frame-border py-5">
			<div className="flex items-center gap-2 ps-8 pe-5">
				{ logo }
				{ isSiteLoading ? (
					<div className="h-5 w-40 rounded skeleton-bg" aria-label={ __( 'Loading site name' ) } />
				) : (
					<>
						<EnvironmentBadge type={ getSiteEnvironment( connectedSite ) } />
						<div className={ cx( 'a8c-label-semibold', hasConnectionErrors && 'error-message' ) }>
							{ connectedSite.name }
						</div>
					</>
				) }
				<div className="ms-auto">
					<Tooltip
						text={ __(
							'This site is syncing. Please wait for the sync to finish before you can disconnect it.'
						) }
						disabled={ ! isDoingLocalSyncWork || isOffline }
						placement="top-start"
					>
						<Button
							variant="link"
							className={ cx(
								! isDoingLocalSyncWork ? '!text-frame-text-secondary hover:!text-a8c-red-50' : ''
							) }
							onClick={ handleDisconnectSite }
							disabled={ isDoingLocalSyncWork }
						>
							{ __( 'Disconnect' ) }
						</Button>
					</Tooltip>
				</div>
			</div>

			{ hasConnectionErrors && (
				<div className="flex items-center px-8">
					<div className="text-frame-text">
						{ createInterpolateElement(
							__(
								'<siteUrlButton/> appears to be deleted or is currently unreachable. <button>Get help ↗</button>'
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
