import { Icon } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { cloudUpload, cloudDownload, info } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useMemo } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { OpenSitesSyncSelector } from 'src/components/content-tab-sync';
import { EnvironmentBadge } from 'src/components/environment-badge';
import { CircleRedCrossIcon } from 'src/components/icons/circle-red-cross';
import offlineIcon from 'src/components/offline-icon';
import { PressableLogo } from 'src/components/pressable-logo';
import ProgressBar from 'src/components/progress-bar';
import { SyncPullPushClear } from 'src/components/sync-pull-push-clear';
import { Tooltip, DynamicTooltip } from 'src/components/tooltip';
import { WordPressLogoCircle } from 'src/components/wordpress-logo-circle';
import { useSyncSites } from 'src/hooks/sync-sites';
import { SYNC_OPTIONS, SyncOption, isSyncOption } from 'src/hooks/sync-sites/sync-option';
import { useConfirmationDialog } from 'src/hooks/use-confirmation-dialog';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useImportExport } from 'src/hooks/use-import-export';
import { useOffline } from 'src/hooks/use-offline';
import { useSyncStatesProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { SyncDialog } from 'src/modules/sync-site/sync-dialog';
import { useI18nLocale } from 'src/stores';
import type { TreeNode } from 'src/components/tree-view';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

interface ConnectedSiteSection {
	id: number;
	name: string;
	provider: 'wpcom';
	connectedSites: SyncSite[];
}

export type SyncOptionsWithSelections = {
	optionsToSync: SyncOption[];
	specificSelections?: {
		plugins?: string[];
		themes?: string[];
	};
};

export const convertTreeToOptionsToSync = ( tree: TreeNode[] ): SyncOptionsWithSelections => {
	const optionsToSync: SyncOption[] = [];
	let specificSelections: { plugins?: string[]; themes?: string[] } | undefined = undefined;

	const isAll = tree.every( ( node ) => node.checked );
	if ( isAll ) {
		optionsToSync.push( SYNC_OPTIONS.all );
	} else {
		const isDatabaseSelected = tree.find( ( node ) => node.id === SYNC_OPTIONS.sqls )?.checked;

		if ( isDatabaseSelected ) {
			optionsToSync.push( SYNC_OPTIONS.sqls );
		}

		const filesAndFolders = tree.find( ( node ) => node.id === 'filesAndFolders' )?.children || [];
		const wpContent = filesAndFolders.find( ( node ) => node.id === 'wp-content' )?.children || [];

		wpContent.forEach( ( item ) => {
			if ( ! isSyncOption( item.id ) ) {
				return;
			}

			if ( item.checked || item.indeterminate ) {
				optionsToSync.push( item.id );
			}

			if (
				item.children &&
				( item.id === SYNC_OPTIONS.plugins || item.id === SYNC_OPTIONS.themes )
			) {
				const selectedItems = item.children
					.filter( ( child ) => child.checked )
					.map( ( child ) => child.id );
				if ( selectedItems.length > 0 && selectedItems.length < item.children.length ) {
					specificSelections = {
						...specificSelections,
						[ item.id ]: selectedItems,
					};
				}
			}
		} );
	}

	return {
		optionsToSync,
		specificSelections,
	};
};

const SyncConnectedSiteControls = ( {
	connectedSite,
	selectedSite,
}: {
	connectedSite: SyncSite;
	selectedSite: SiteDetails;
} ) => {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const { selectiveSyncEnabled } = useFeatureFlags();
	const [ syncDialogType, setSyncDialogType ] = useState< 'pull' | 'push' | null >( null );
	const {
		pullSite,
		isAnySitePulling,
		isAnySitePushing,
		pushSite,
		isSiteIdPulling,
		isSiteIdPushing,
		getLastSyncTimeText,
		connectedSites,
	} = useSyncSites();
	const isAnyConnectedSiteSyncing = connectedSites.some(
		( site ) =>
			isSiteIdPulling( selectedSite.id, site.id ) || isSiteIdPushing( selectedSite.id, site.id )
	);
	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;
	const showPushStagingConfirmation = useConfirmationDialog( {
		localStorageKey: 'dontShowPushConfirmation',
		message: __( 'Overwrite Staging site' ),
		detail: __(
			'Pushing will replace the existing files and database with a copy from your local site.\n\n The staging site will be backed-up before any changes are applied.'
		),
		confirmButtonLabel: __( 'Push' ),
	} );
	const showPushProductionConfirmation = useConfirmationDialog( {
		message: __( 'Overwrite Production site' ),
		detail: __(
			'Pushing will replace the existing files and database with a copy from your local site.\n\n The production site will be backed-up before any changes are applied.'
		),
		confirmButtonLabel: __( 'Push' ),
	} );

	const showPullConfirmation = useConfirmationDialog( {
		localStorageKey: 'dontShowPullConfirmation',
		message: __( 'Overwrite Studio site' ),
		confirmButtonLabel: __( 'Pull' ),
	} );
	const handlePushSite = async ( connectedSite: SyncSite ) => {
		if ( selectiveSyncEnabled ) {
			setSyncDialogType( 'push' );
			return;
		}

		if ( connectedSite.isStaging ) {
			void showPushStagingConfirmation( () => {
				void pushSite( connectedSite, selectedSite );
			} );
		} else {
			void showPushProductionConfirmation( () => {
				void pushSite( connectedSite, selectedSite );
			} );
		}
	};

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
									'!text-black hover:!text-a8c-blueberry'
							) }
							onClick={ () => {
								if ( selectiveSyncEnabled ) {
									setSyncDialogType( 'pull' );
									return;
								}

								const detail = connectedSite.isStaging
									? __(
											"Pulling will replace your Studio site's files and database with a copy from your staging site."
									  )
									: __(
											"Pulling will replace your Studio site's files and database with a copy from your production site."
									  );
								void showPullConfirmation( () => pullSite( connectedSite, selectedSite ), {
									detail,
								} );
							} }
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
									'!text-black hover:!text-a8c-blueberry'
							) }
							onClick={ () => handlePushSite( connectedSite ) }
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
						onSubmit={ ( tree ) => {
							const syncOptions = convertTreeToOptionsToSync( tree );

							if ( syncDialogType === 'push' ) {
								void pushSite( connectedSite, selectedSite, syncOptions );
							} else {
								pullSite( connectedSite, selectedSite, syncOptions );
							}
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
						{ connectedSite.isPressable && connectedSite.environmentType && (
							<div className="shrink-0">
								{ connectedSite.environmentType === 'staging' && (
									<EnvironmentBadge type="staging" />
								) }
								{ connectedSite.environmentType === 'production' && (
									<EnvironmentBadge type="production" />
								) }
								{ connectedSite.environmentType === 'sandbox' && (
									<EnvironmentBadge type="sandbox" />
								) }
							</div>
						) }

						{ ! connectedSite.isPressable && (
							<div className="shrink-0">
								{ connectedSite.isStaging ? (
									<EnvironmentBadge type="staging" />
								) : (
									<EnvironmentBadge type="production" />
								) }
							</div>
						) }

						<Button
							variant="link"
							className="!text-a8c-gray-70 hover:!text-a8c-blueberry max-w-full overflow-hidden"
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
								<SyncPullPushClear
									onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }
									isError
								>
									{ __( 'Error pulling changes' ) }
								</SyncPullPushClear>
							) }
							{ isPushError && (
								<SyncPullPushClear
									onClick={ () => clearPushState( selectedSite.id, connectedSite.id ) }
									isError
								>
									{ __( 'Error pushing changes' ) }
								</SyncPullPushClear>
							) }
							{ hasPullFinished && (
								<SyncPullPushClear
									onClick={ () => clearPullState( selectedSite.id, connectedSite.id ) }
								>
									{ __( 'Pull complete' ) }
								</SyncPullPushClear>
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
								<SyncPullPushClear
									onClick={ () => clearPushState( selectedSite.id, connectedSite.id ) }
								>
									{ pushState.status.message }
								</SyncPullPushClear>
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
	openSitesSyncSelector: OpenSitesSyncSelector;
};

const SyncConnectedSiteSection = ( {
	section,
	disconnectSite,
	selectedSite,
	openSitesSyncSelector,
}: SyncConnectedSiteSectionProps ) => {
	const { __ } = useI18n();
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
						onClick={ () => openSitesSyncSelector( { disconnectSiteId: section.id } ) }
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
	openSitesSyncSelector,
	disconnectSite,
	selectedSite,
}: {
	connectedSites: SyncSite[];
	openSitesSyncSelector: OpenSitesSyncSelector;
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
					openSitesSyncSelector={ openSitesSyncSelector }
				/>
			) ) }
		</div>
	);
}
