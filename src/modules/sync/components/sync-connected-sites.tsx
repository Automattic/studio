import { Icon } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { cloudUpload, cloudDownload, info } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useMemo } from 'react';
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
import { useImportExport } from 'src/hooks/use-import-export';
import { useOffline } from 'src/hooks/use-offline';
import { useSyncStatesProgressInfo } from 'src/hooks/use-sync-states-progress-info';
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
import { connectedSitesActions, useConnectedSitesData } from 'src/stores/sync';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

interface ConnectedSiteSection {
	id: number;
	name: string;
	provider: 'wpcom';
	connectedSites: SyncSite[];
}

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
	const { connectedSites } = useConnectedSitesData();
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
	connectedSites: SyncSite[];
};

const SyncConnectedSitesList = ( {
	selectedSite,
	connectedSites,
}: SyncConnectedSitesListProps ) => {
	const { __ } = useI18n();
	const { clearPullState, getPullState, getPushState, clearPushState } = useSyncSites();
	const { importState } = useImportExport();
	const { isKeyPulling, isKeyPushing, isKeyFinished, isKeyFailed, getPullStatusWithProgress } =
		useSyncStatesProgressInfo();

	return (
		<div className="grid grid-cols-[max-content_1fr_max-content]">
			{ connectedSites.map( ( connectedSite ) => {
				const sitePullState = getPullState( selectedSite.id, connectedSite.id );
				const isPulling = sitePullState && isKeyPulling( sitePullState.status.key );
				const isPullError = sitePullState && isKeyFailed( sitePullState.status.key );
				const hasPullFinished = sitePullState && isKeyFinished( sitePullState.status.key );
				const { message: sitePullStatusMessage, progress: sitePullStatusProgress } =
					getPullStatusWithProgress(
						sitePullState?.status,
						importState[ connectedSite.localSiteId ]
					);

				const pushState = getPushState( selectedSite.id, connectedSite.id );
				const isPushing = pushState && isKeyPushing( pushState.status.key );
				const isPushError = pushState && isKeyFailed( pushState.status.key );
				const hasPushFinished = pushState && isKeyFinished( pushState.status.key );

				return (
					<div
						className={ `col-span-3 grid min-h-14 px-8 gap-4 justify-items-start items-center border-b border-a8c-gray-0 ${
							connectedSite.isPressable && ! connectedSite.environmentType
								? 'grid-cols-[1fr_auto]'
								: 'grid-cols-subgrid'
						}` }
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
								<div className="flex flex-col gap-2 min-w-44">
									<div className="a8c-body-small">{ sitePullStatusMessage }</div>
									<ProgressBar value={ sitePullStatusProgress } maxValue={ 100 } />
								</div>
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
							{ pushState?.status && isPushing && (
								<Tooltip
									text={ __(
										'Push is in progress. We will send you an email when it is completed.'
									) }
									placement="top-start"
								>
									<div className="flex flex-col gap-2 min-w-44">
										<div className="a8c-body-small flex items-center gap-0.5">
											<Icon icon={ info } size={ 16 } />
											{ pushState.status.message }
										</div>
										<ProgressBar value={ pushState.status.progress } maxValue={ 100 } />
									</div>
								</Tooltip>
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
								! hasPushFinished && (
									<SyncConnectedSiteControls
										connectedSite={ connectedSite }
										selectedSite={ selectedSite }
									/>
								) }
						</div>
					</div>
				);
			} ) }
		</div>
	);
};

type SyncConnectedSiteSectionProps = {
	section: ConnectedSiteSection;
	disconnectSite: ( id: number ) => void;
	selectedSite: SiteDetails;
};

const SyncConnectedSiteSection = ( {
	section,
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

			const disconnectMessage = section.name
				? sprintf( __( 'Disconnect %s' ), section.name )
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
				disconnectSite( section.id );
				section.connectedSites.forEach( ( connectedSite ) => {
					clearPullState( selectedSite.id, connectedSite.id );
				} );
			}
		} else {
			disconnectSite( section.id );
		}
	};

	const mainSite = section.connectedSites.find( ( item ) => ! item.isStaging );
	const hasConnectionErrors = mainSite?.syncSupport !== 'already-connected';
	const isPulling = section.connectedSites.some( ( site ) =>
		isSiteIdPulling( selectedSite.id, site.id )
	);
	const isPushing = section.connectedSites.some( ( site ) =>
		isSiteIdPushing( selectedSite.id, site.id )
	);

	let logo = <WordPressLogoCircle />;
	if ( hasConnectionErrors ) {
		logo = <CircleRedCrossIcon />;
	} else if ( mainSite?.isPressable ) {
		logo = <PressableLogo />;
	}

	return (
		<div key={ section.id } className="flex flex-col gap-2 mb-6">
			<div className="flex items-center gap-2 border-b border-a8c-gray-0 px-8 pb-2.5">
				{ logo }
				<div className={ cx( 'a8c-label-semibold', hasConnectionErrors && 'error-message' ) }>
					{ section.name }
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
				<div className="flex items-center min-h-14 border-b border-a8c-gray-0 px-8">
					<div className="text-[#3C434A]">
						{ createInterpolateElement(
							__( "Studio couldn't connect to this site. <button>Get help ↗️</button>" ),
							{
								button: (
									<Button
										variant="link"
										onClick={ () => getIpcApi().openURL( getLocalizedLink( locale, 'docsSync' ) ) }
									/>
								),
							}
						) }
					</div>
					<Button
						onClick={ () => {
							disconnectSite( section.id );
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
				<SyncConnectedSitesList
					selectedSite={ selectedSite }
					connectedSites={ section.connectedSites }
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
	const siteSections: ConnectedSiteSection[] = useMemo( () => {
		const siteSections: ConnectedSiteSection[] = [];
		const processedSites = new Set< number >();

		connectedSites.forEach( ( connectedSite ) => {
			if ( processedSites.has( connectedSite.id ) ) {
				return; // Skip if we've already processed this site
			}

			const section: ConnectedSiteSection = {
				id: connectedSite.id,
				name: connectedSite.name,
				provider: 'wpcom',
				connectedSites: [ connectedSite ],
			};

			processedSites.add( connectedSite.id );

			if ( connectedSite.stagingSiteIds ) {
				for ( const id of connectedSite.stagingSiteIds ) {
					const stagingSite = connectedSites.find( ( site ) => site.id === id );
					if ( stagingSite ) {
						section.connectedSites.push( stagingSite );
						processedSites.add( stagingSite.id );
					}
				}
			}

			siteSections.push( section );
		} );

		return siteSections;
	}, [ connectedSites ] );

	return (
		<div className="flex flex-col flex-1 pt-8">
			{ siteSections.map( ( section ) => (
				<SyncConnectedSiteSection
					key={ section.id }
					section={ section }
					selectedSite={ selectedSite }
					disconnectSite={ disconnectSite }
				/>
			) ) }
		</div>
	);
}
