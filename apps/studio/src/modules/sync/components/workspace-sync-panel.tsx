import { CheckboxControl, Icon, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { cloudDownload, cloudUpload } from '@wordpress/icons';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { Tooltip } from 'src/components/tooltip';
import { TreeView, updateNodeById, type TreeNode } from 'src/components/tree-view';
import { useAddSite } from 'src/hooks/use-add-site';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { SyncConnectedSiteControls } from 'src/modules/sync/components/sync-connected-sites';
import {
	SyncFilesSelectControl,
	type SyncFilesSelectionMode,
} from 'src/modules/sync/components/sync-files-select-control';
import { SyncModalShell } from 'src/modules/sync/components/sync-modal-shell';
import { TreeViewLoadingSkeleton } from 'src/modules/sync/components/tree-view-loading-skeleton';
import { useWorkspaceSelection } from 'src/modules/workspaces';
import { useAppDispatch, useI18nLocale, useRootSelector } from 'src/stores';
import {
	stagingSyncSelectors,
	stagingSyncThunks,
	syncOperationsSelectors,
	type StagingSyncDirection,
	type StagingSyncOption,
	type StagingSyncOptions,
} from 'src/stores/sync';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import { useLatestRewindId, useRemoteFileTree } from 'src/stores/sync/sync-hooks';
import type { SyncSite } from '@studio/common/types/sync';
import type { StudioWorkspace, WorkspaceTargetId } from 'src/modules/workspaces/types';

type WorkspaceSyncPanelContentProps = {
	workspace: StudioWorkspace;
	selectedTargetId?: WorkspaceTargetId;
};

type EnvironmentSyncDialogProps = {
	direction: StagingSyncDirection;
	productionSite: SyncSite;
	stagingSite: SyncSite;
	onClose: () => void;
};

const ENVIRONMENT_FILE_SYNC_OPTIONS: StagingSyncOption[] = [
	'contents',
	'themes',
	'plugins',
	'uploads',
	'roots',
];

const createEnvironmentFileTree = (): TreeNode[] => [
	{
		id: 'wp-content',
		name: 'wp-content',
		label: 'wp-content',
		checked: false,
		indeterminate: false,
		type: 'folder',
		children: [],
		expanded: true,
	},
];

function collectSelectedPathIds( nodes: TreeNode[] | undefined ): string[] {
	if ( ! nodes?.length ) {
		return [];
	}

	return nodes.flatMap( ( node ) => {
		const selectedPathIds: string[] = [];
		if ( node.checked && node.pathId ) {
			selectedPathIds.push( node.pathId );
		}
		if ( node.children?.length && ( node.checked || node.indeterminate ) ) {
			selectedPathIds.push( ...collectSelectedPathIds( node.children ) );
		}
		return selectedPathIds;
	} );
}

function isRemoteConnectedToLocal( remoteSite: SyncSite | undefined, localSite?: SiteDetails ) {
	return Boolean(
		remoteSite &&
			localSite &&
			remoteSite.localSiteId === localSite.id &&
			remoteSite.syncSupport === 'already-connected'
	);
}

function getRemoteSiteLocalSetupState( remoteSite: SyncSite ) {
	switch ( remoteSite.syncSupport ) {
		case 'syncable':
			return {
				canUseLocalSetup: true,
			};
		case 'needs-upgrade':
			return {
				canUseLocalSetup: false,
				description: __( 'Upgrade this site plan before creating or connecting a local version.' ),
				buttonLabel: __( 'Upgrade plan' ),
				actionUrl: `https://wordpress.com/plans/${ remoteSite.id }`,
			};
		case 'needs-transfer':
			return {
				canUseLocalSetup: false,
				description: __( 'Enable hosting features before creating or connecting a local version.' ),
				buttonLabel: __( 'Enable hosting' ),
				actionUrl: `https://wordpress.com/hosting-features/${ remoteSite.id }`,
			};
		case 'missing-permissions':
			return {
				canUseLocalSetup: false,
				description: __(
					'You need permission to manage this site before creating or connecting a local version.'
				),
				buttonLabel: __( 'Missing permissions' ),
			};
		case 'deleted':
			return {
				canUseLocalSetup: false,
				description: __( 'This WordPress.com site is deleted.' ),
				buttonLabel: __( 'Deleted' ),
			};
		case 'unsupported':
			return {
				canUseLocalSetup: false,
				description: __( 'This site does not support Studio sync.' ),
				buttonLabel: __( 'Unsupported' ),
			};
		case 'already-connected':
			return {
				canUseLocalSetup: false,
				description: __( 'This target is already connected to another local site.' ),
				buttonLabel: __( 'Already connected' ),
			};
	}
}

function getProductionStagingSetupState( productionSite: SyncSite ) {
	if ( productionSite.canManageOptions === false ) {
		return {
			canCreateStagingSite: false,
			description: __(
				'You need permission to manage this production site before creating staging.'
			),
			buttonLabel: __( 'Missing permissions' ),
		};
	}

	if ( productionSite.hasStagingSiteFeature === false ) {
		return {
			canCreateStagingSite: false,
			description: __( 'This site plan does not include staging sites.' ),
			buttonLabel: __( 'Upgrade plan' ),
			actionUrl: `https://wordpress.com/plans/${ productionSite.id }`,
		};
	}

	if ( productionSite.isWpcomAtomic === false ) {
		return {
			canCreateStagingSite: false,
			description: __( 'Enable hosting features before creating a staging site.' ),
			buttonLabel: __( 'Enable hosting' ),
			actionUrl: `https://wordpress.com/hosting-features/${ productionSite.id }`,
		};
	}

	return {
		canCreateStagingSite: true,
		description: __( 'Create a staging target from Production before syncing environments.' ),
		buttonLabel: __( 'Create staging site' ),
	};
}

function useLocalRemoteSyncState( localSite?: SiteDetails, remoteSite?: SyncSite ) {
	const isPulling = useRootSelector(
		syncOperationsSelectors.selectIsSiteIdPulling( localSite?.id ?? '', remoteSite?.id )
	);
	const isPushing = useRootSelector(
		syncOperationsSelectors.selectIsSiteIdPushing( localSite?.id ?? '', remoteSite?.id )
	);

	return {
		isSyncing: isPulling || isPushing,
	};
}

function EnvironmentSyncDialog( {
	direction,
	productionSite,
	stagingSite,
	onClose,
}: EnvironmentSyncDialogProps ) {
	const locale = useI18nLocale();
	const dispatch = useAppDispatch();
	const [ includeFiles, setIncludeFiles ] = useState( false );
	const [ includeDatabase, setIncludeDatabase ] = useState( false );
	const [ fileSelectionMode, setFileSelectionMode ] = useState< SyncFilesSelectionMode >( 'all' );
	const [ fileTree, setFileTree ] = useState< TreeNode[] >( () => createEnvironmentFileTree() );
	const [ fileTreeError, setFileTreeError ] = useState< Error | null >( null );
	const [ isLoadingFileTree, setIsLoadingFileTree ] = useState( false );
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const isPull = direction === 'pull';
	const title = isPull ? __( 'Pull from Staging' ) : __( 'Push to Staging' );
	const actionLabel = isPull ? __( 'Pull' ) : __( 'Push' );
	const sourceSite = isPull ? stagingSite : productionSite;
	const destinationSite = isPull ? productionSite : stagingSite;
	const isUsingSpecificFileSelection = includeFiles && fileSelectionMode === 'specific';
	const selectedPathIds = useMemo( () => collectSelectedPathIds( fileTree ), [ fileTree ] );
	const selectedOptions: StagingSyncOptions = isUsingSpecificFileSelection
		? {
				types: 'paths',
				include_paths: selectedPathIds,
				exclude_paths: [],
		  }
		: [
				...( includeFiles ? ENVIRONMENT_FILE_SYNC_OPTIONS : [] ),
				...( includeDatabase ? ( [ 'sqls' ] as const ) : [] ),
		  ];
	const hasSelectedOptions = Array.isArray( selectedOptions )
		? selectedOptions.length > 0
		: selectedOptions.include_paths.length > 0;
	const syncDescription = isPull
		? __(
				"Pulling will overwrite your production site's selected files and database with a copy from your staging site. Unchecked items will not be changed."
		  )
		: __(
				"Pushing will overwrite your staging site's selected files and database with a copy from your production site. Unchecked items will not be changed."
		  );
	const subtitle = isPull
		? __( 'What would you like to pull?' )
		: __( 'What would you like to push?' );
	const docsLabel = isPull
		? __( 'Read more about environment pull' )
		: __( 'Read more about environment push' );
	const sourceEnvironment = isPull ? 'staging' : 'production';
	const destinationEnvironment = isPull ? 'production' : 'staging';
	const {
		rewindId,
		isLoading: isLoadingRewindId,
		isError: isErrorRewindId,
	} = useLatestRewindId( sourceSite.id, {
		skip: ! isUsingSpecificFileSelection,
	} );
	const { fetchChildren } = useRemoteFileTree();
	const isSubmitDisabled =
		! hasSelectedOptions || isSubmitting || isLoadingRewindId || isLoadingFileTree;

	useEffect( () => {
		setFileTree( createEnvironmentFileTree() );
		setFileTreeError( null );
	}, [ sourceSite.id ] );

	useEffect( () => {
		if ( ! isUsingSpecificFileSelection || ! rewindId ) {
			return;
		}

		let isCancelled = false;
		const loadSourceFileTree = async () => {
			setIsLoadingFileTree( true );
			setFileTreeError( null );
			try {
				const children = await fetchChildren( sourceSite.id, rewindId, '/wp-content/', false );
				if ( ! isCancelled ) {
					setFileTree( ( previousFileTree ) =>
						updateNodeById( previousFileTree, 'wp-content', { children } )
					);
				}
			} catch ( error ) {
				if ( ! isCancelled ) {
					setFileTreeError( error instanceof Error ? error : new Error( String( error ) ) );
				}
			} finally {
				if ( ! isCancelled ) {
					setIsLoadingFileTree( false );
				}
			}
		};

		void loadSourceFileTree();

		return () => {
			isCancelled = true;
		};
	}, [ fetchChildren, isUsingSpecificFileSelection, rewindId, sourceSite.id ] );

	const handleFileSelectionModeChange = ( nextMode: SyncFilesSelectionMode ) => {
		setFileSelectionMode( nextMode );
		if ( nextMode === 'specific' ) {
			setIncludeFiles( true );
			setIncludeDatabase( false );
		}
	};

	const handleIncludeFilesChange = ( checked: boolean ) => {
		setIncludeFiles( checked );
		if ( ! checked ) {
			setFileSelectionMode( 'all' );
			setFileTree( createEnvironmentFileTree() );
		}
	};

	const handleExpandFileTreeNode = useCallback(
		async ( node: TreeNode ) => {
			if ( ! rewindId || ! node.path || node.children?.length ) {
				return;
			}

			try {
				const children = await fetchChildren( sourceSite.id, rewindId, node.path, node.checked );
				setFileTree( ( previousFileTree ) =>
					updateNodeById( previousFileTree, node.id, {
						children,
						loading: false,
						hasError: false,
					} )
				);
			} catch ( error ) {
				setFileTree( ( previousFileTree ) =>
					updateNodeById( previousFileTree, node.id, {
						children: [],
						loading: false,
						hasError: true,
					} )
				);
			}
		},
		[ fetchChildren, rewindId, sourceSite.id ]
	);

	const runEnvironmentSync = async ( allowWooSync = false ) => {
		if ( ! hasSelectedOptions ) {
			return;
		}

		setIsSubmitting( true );
		const result = await dispatch(
			stagingSyncThunks.startStagingSiteSync( {
				productionSite,
				stagingSite,
				direction,
				options: selectedOptions,
				allowWooSync,
			} )
		);
		setIsSubmitting( false );

		if ( stagingSyncThunks.startStagingSiteSync.fulfilled.match( result ) ) {
			onClose();
			return;
		}

		const error = result.payload;
		if ( isPull && includeDatabase && error?.code === 'rest_sqls_option_not_supported' ) {
			const { response } = await getIpcApi().showMessageBox( {
				message: __( 'Pull production database from a WooCommerce staging site?' ),
				detail: __(
					'WooCommerce data can be sensitive. Confirm that the staging database should overwrite production, then Studio will retry this sync.'
				),
				buttons: [ __( 'Retry with database' ), __( 'Cancel' ) ],
				cancelId: 1,
			} );

			if ( response === 0 ) {
				await runEnvironmentSync( true );
			}
			return;
		}

		getIpcApi().showErrorMessageBox( {
			title: __( 'Could not sync staging site' ),
			message: error?.message ?? __( 'The staging sync could not be started.' ),
		} );
	};

	return (
		<SyncModalShell
			title={ title }
			description={ syncDescription }
			subtitle={ subtitle }
			source={ { name: sourceSite.name, envType: sourceEnvironment } }
			destination={ { name: destinationSite.name, envType: destinationEnvironment } }
			onRequestClose={ onClose }
			contentClassName="pb-[106px]"
			footer={
				<div className="flex justify-between items-center">
					<div>
						<Button
							variant="link"
							onClick={ () =>
								getIpcApi().openURL( getLocalizedLink( locale, 'docsSync' ) + '#' + direction )
							}
						>
							{ docsLabel } <ArrowIcon />
						</Button>
					</div>
					<div className="flex gap-4 justify-end">
						<Button variant="link" onClick={ onClose } disabled={ isSubmitting }>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ () => void runEnvironmentSync() }
							disabled={ isSubmitDisabled }
							data-testid="environment-sync-submit-button"
						>
							{ actionLabel }
						</Button>
					</div>
				</div>
			}
		>
			<div className="px-8 pb-8">
				<div className="relative py-3">
					<div className="pe-56">
						<CheckboxControl
							label={ __( 'Files and folders' ) }
							checked={ includeFiles }
							onChange={ handleIncludeFilesChange }
						/>
					</div>
					<div className="absolute end-0 top-[7px]">
						<SyncFilesSelectControl
							value={ fileSelectionMode }
							onChange={ handleFileSelectionModeChange }
						/>
					</div>
				</div>
				{ isUsingSpecificFileSelection && (
					<div className="pb-4">
						{ isLoadingRewindId || isLoadingFileTree ? (
							<TreeViewLoadingSkeleton />
						) : isErrorRewindId || fileTreeError ? (
							<div className="rounded border border-frame-border p-3 text-sm text-frame-text-secondary">
								{ __(
									'Could not load source site files. Please close and reopen this dialog to try again.'
								) }
							</div>
						) : (
							<TreeView
								tree={ fileTree }
								setTree={ setFileTree }
								onExpand={ handleExpandFileTreeNode }
								renderEmptyContent={ ( nodeId, node ) => {
									if ( nodeId === 'wp-content' && fileTreeError ) {
										return (
											<div className="text-frame-text-secondary italic">
												{ __(
													'Could not load source site files. Please close and reopen this dialog to try again.'
												) }
											</div>
										);
									}
									if ( node.hasError ) {
										return (
											<div className="text-frame-text-secondary italic">
												{ __(
													'Error retrieving remote files and directories. Please collapse and expand this folder to try again.'
												) }
											</div>
										);
									}
									return (
										<div
											className="text-frame-text-secondary italic"
											aria-label={ __( 'Empty folder' ) }
										>
											{ __( 'Empty' ) }
										</div>
									);
								} }
							/>
						) }
					</div>
				) }
				<div className="py-3">
					<CheckboxControl
						label={ __( 'Database' ) }
						checked={ includeDatabase }
						disabled={ isUsingSpecificFileSelection }
						onChange={ setIncludeDatabase }
					/>
				</div>
			</div>
		</SyncModalShell>
	);
}

function WorkspaceSyncRow( {
	label,
	description,
	active,
	children,
}: {
	label: string;
	description: string;
	active?: boolean;
	children: ReactNode;
} ) {
	return (
		<div
			className={ cx(
				'grid grid-cols-[1fr_auto] items-center gap-4 rounded border bg-white p-3',
				active ? 'border-frame-theme' : 'border-a8c-gray-5'
			) }
		>
			<div className="min-w-0">
				<div className="text-sm font-medium text-frame-text">{ label }</div>
				<div className="truncate text-xs text-frame-text-secondary">{ description }</div>
			</div>
			<div>{ children }</div>
		</div>
	);
}

function LocalRemoteSyncRow( {
	label,
	localSite,
	remoteSite,
	remoteTargetId,
	disabled,
	active,
	onCreateLocalSite,
	onConnectRemoteSite,
	isCreatingLocalSite,
	isConnectingSite,
}: {
	label: string;
	localSite?: SiteDetails;
	remoteSite?: SyncSite;
	remoteTargetId: Extract< WorkspaceTargetId, 'production' | 'staging' >;
	disabled?: boolean;
	active?: boolean;
	onCreateLocalSite: ( remoteSite: SyncSite ) => void;
	onConnectRemoteSite: ( remoteSite: SyncSite, localSite: SiteDetails ) => void;
	isCreatingLocalSite?: boolean;
	isConnectingSite?: boolean;
} ) {
	const isConnected = isRemoteConnectedToLocal( remoteSite, localSite );
	const missingDescription =
		remoteTargetId === 'production'
			? __( 'Connect or create a Production target before syncing this link.' )
			: __( 'Connect or create a Staging target before syncing this link.' );
	const disabledReason = __( 'Wait for the Production/Staging sync to finish.' );
	const localSetupState = remoteSite ? getRemoteSiteLocalSetupState( remoteSite ) : undefined;
	const canUseLocalSetup = localSetupState?.canUseLocalSetup;
	const canConnectRemoteSite = Boolean( localSite && remoteSite && canUseLocalSetup );
	const description =
		isConnected && remoteSite
			? remoteSite.url
			: remoteSite && ! canUseLocalSetup && localSetupState
			? localSetupState.description ?? missingDescription
			: remoteSite && ! localSite
			? __( 'Create a local copy of this target before syncing.' )
			: remoteSite && localSite
			? __( 'Connect this target to the local site before syncing.' )
			: missingDescription;

	return (
		<WorkspaceSyncRow label={ label } description={ description } active={ active }>
			<div className={ cx( disabled && 'opacity-50' ) }>
				{ isConnected && localSite && remoteSite ? (
					<SyncConnectedSiteControls
						connectedSite={ remoteSite }
						selectedSite={ localSite }
						disabled={ disabled }
						disabledReason={ disabledReason }
					/>
				) : remoteSite && ! localSite && canUseLocalSetup ? (
					<Tooltip text={ disabledReason } disabled={ ! disabled } placement="top-start">
						<Button
							variant="tertiary"
							onClick={ () => onCreateLocalSite( remoteSite ) }
							disabled={ disabled || isCreatingLocalSite }
						>
							{ isCreatingLocalSite ? __( 'Creating...' ) : __( 'Create local copy' ) }
						</Button>
					</Tooltip>
				) : remoteSite && localSite && canConnectRemoteSite ? (
					<Tooltip text={ disabledReason } disabled={ ! disabled } placement="top-start">
						<Button
							variant="tertiary"
							onClick={ () => onConnectRemoteSite( remoteSite, localSite ) }
							disabled={ disabled || isConnectingSite }
						>
							{ isConnectingSite ? __( 'Connecting...' ) : __( 'Connect' ) }
						</Button>
					</Tooltip>
				) : remoteSite && localSetupState?.actionUrl ? (
					<Tooltip text={ disabledReason } disabled={ ! disabled } placement="top-start">
						<Button
							variant="tertiary"
							onClick={ () => getIpcApi().openURL( localSetupState.actionUrl ) }
							disabled={ disabled }
						>
							{ localSetupState.buttonLabel }
							<ArrowIcon />
						</Button>
					</Tooltip>
				) : (
					<Button variant="tertiary" disabled>
						{ localSetupState?.buttonLabel ?? __( 'Unavailable' ) }
					</Button>
				) }
			</div>
		</WorkspaceSyncRow>
	);
}

function EnvironmentSyncRow( {
	productionSite,
	stagingSite,
	disabled,
	active,
	onOpenDialog,
	onCreateStagingSite,
	isCreatingStagingSite,
}: {
	productionSite?: SyncSite;
	stagingSite?: SyncSite;
	disabled: boolean;
	active?: boolean;
	onOpenDialog: ( direction: StagingSyncDirection ) => void;
	onCreateStagingSite: ( productionSite: SyncSite ) => void;
	isCreatingStagingSite?: boolean;
} ) {
	const stagingSyncState = useRootSelector(
		stagingSyncSelectors.selectState( productionSite?.id )
	);
	const isEnvironmentSyncing = useRootSelector(
		stagingSyncSelectors.selectIsProductionSiteSyncing( productionSite?.id )
	);
	const hasKnownStagingSite = Boolean( productionSite?.stagingSiteIds?.length );
	const stagingSetupState = productionSite
		? getProductionStagingSetupState( productionSite )
		: undefined;
	const canCreateStagingSite =
		Boolean( productionSite && ! stagingSite && ! hasKnownStagingSite ) &&
		stagingSetupState?.canCreateStagingSite;
	const disabledReason = disabled
		? __( 'Wait for the local sync operation to finish.' )
		: ! productionSite
		? __( 'Production site details are required before creating or syncing staging.' )
		: productionSite && ! stagingSite && hasKnownStagingSite
		? __( 'A staging site is linked to this production site but its details have not loaded yet.' )
		: undefined;
	const description = ! productionSite
		? __( 'Add a Production target before creating or syncing staging.' )
		: ! stagingSite
		? hasKnownStagingSite
			? __( 'Staging site details are still loading.' )
			: stagingSetupState?.description ??
			  __( 'Create a staging target from Production before syncing environments.' )
		: stagingSyncState?.status === 'failed'
		? stagingSyncState.error?.message ?? __( 'Environment sync failed.' )
		: isEnvironmentSyncing
		? __( 'Environment sync is running.' )
		: stagingSyncState?.status === 'completed'
		? __( 'Last environment sync completed.' )
		: __( 'Copy content between production and staging.' );

	return (
		<WorkspaceSyncRow
			label={ __( 'Production <-> Staging' ) }
			description={ description }
			active={ active }
		>
			<Tooltip text={ disabledReason } disabled={ ! disabledReason } placement="top-start">
				<div className="flex items-center gap-2">
					{ isEnvironmentSyncing && <Spinner className="!m-0 !h-4 !w-4" /> }
					{ productionSite && stagingSite ? (
						<>
							<Button
								variant="tertiary"
								onClick={ () => onOpenDialog( 'push' ) }
								disabled={ disabled || isEnvironmentSyncing }
							>
								<Icon icon={ cloudUpload } />
								{ __( 'Push to Staging' ) }
							</Button>
							<Button
								variant="tertiary"
								onClick={ () => onOpenDialog( 'pull' ) }
								disabled={ disabled || isEnvironmentSyncing }
							>
								<Icon icon={ cloudDownload } />
								{ __( 'Pull to Production' ) }
							</Button>
						</>
					) : productionSite && canCreateStagingSite ? (
						<Button
							variant="tertiary"
							onClick={ () => onCreateStagingSite( productionSite ) }
							disabled={ disabled || isCreatingStagingSite }
						>
							{ isCreatingStagingSite ? __( 'Creating...' ) : __( 'Create staging site' ) }
						</Button>
					) : productionSite && ! stagingSite && stagingSetupState?.actionUrl ? (
						<Button
							variant="tertiary"
							onClick={ () => getIpcApi().openURL( stagingSetupState.actionUrl ) }
							disabled={ disabled }
						>
							{ stagingSetupState.buttonLabel }
							<ArrowIcon />
						</Button>
					) : (
						<Button variant="tertiary" disabled>
							{ stagingSetupState?.buttonLabel ?? __( 'Unavailable' ) }
						</Button>
					) }
				</div>
			</Tooltip>
		</WorkspaceSyncRow>
	);
}

export function WorkspaceSyncPanelContent( {
	workspace,
	selectedTargetId,
}: WorkspaceSyncPanelContentProps ) {
	const dispatch = useAppDispatch();
	const { createSiteFromRemoteSite } = useAddSite();
	const { refreshWorkspaces } = useWorkspaceSelection();
	const [ connectSite ] = useConnectSiteMutation();
	const [ environmentSyncDirection, setEnvironmentSyncDirection ] =
		useState< StagingSyncDirection | null >( null );
	const [ creatingLocalSiteId, setCreatingLocalSiteId ] = useState< number | null >( null );
	const [ connectingRemoteSiteId, setConnectingRemoteSiteId ] = useState< number | null >( null );
	const [ creatingStagingProductionSiteId, setCreatingStagingProductionSiteId ] = useState<
		number | null
	>( null );
	const localSite = workspace.targets.local?.site;
	const productionSite = workspace.targets.production?.site;
	const stagingSite = workspace.targets.staging?.site;
	const localProductionSyncState = useLocalRemoteSyncState( localSite, productionSite );
	const localStagingSyncState = useLocalRemoteSyncState( localSite, stagingSite );
	const isEnvironmentSyncing = useRootSelector(
		stagingSyncSelectors.selectIsProductionSiteSyncing( productionSite?.id )
	);
	const isAnyLocalRemoteSyncing =
		localProductionSyncState.isSyncing || localStagingSyncState.isSyncing;
	const shouldShowLocalProductionRow = Boolean( localSite || productionSite );
	const shouldShowLocalStagingRow = Boolean( stagingSite && ( localSite || ! productionSite ) );
	const shouldShowEnvironmentRow = Boolean( productionSite || stagingSite );

	const handleCreateLocalSite = useCallback(
		async ( remoteSite: SyncSite ) => {
			setCreatingLocalSiteId( remoteSite.id );
			try {
				await createSiteFromRemoteSite( remoteSite );
				refreshWorkspaces();
			} catch ( error ) {
				getIpcApi().showErrorMessageBox( {
					title: __( 'Could not create local site' ),
					message:
						error instanceof Error
							? error.message
							: __( 'The local site could not be created from this WordPress.com site.' ),
				} );
			} finally {
				setCreatingLocalSiteId( null );
			}
		},
		[ createSiteFromRemoteSite, refreshWorkspaces ]
	);

	const handleConnectRemoteSite = useCallback(
		async ( remoteSite: SyncSite, site: SiteDetails ) => {
			setConnectingRemoteSiteId( remoteSite.id );
			try {
				const result = await connectSite( { site: remoteSite, localSiteId: site.id } );
				if ( 'error' in result ) {
					throw result.error;
				}
				refreshWorkspaces();
			} catch ( error ) {
				getIpcApi().showErrorMessageBox( {
					title: __( 'Could not connect site' ),
					message:
						error instanceof Error
							? error.message
							: __( 'The WordPress.com site could not be connected to this local site.' ),
				} );
			} finally {
				setConnectingRemoteSiteId( null );
			}
		},
		[ connectSite, refreshWorkspaces ]
	);

	const handleCreateStagingSite = useCallback(
		async ( site: SyncSite ) => {
			setCreatingStagingProductionSiteId( site.id );
			const result = await dispatch(
				stagingSyncThunks.createStagingSite( { productionSite: site } )
			);
			setCreatingStagingProductionSiteId( null );

			if ( stagingSyncThunks.createStagingSite.fulfilled.match( result ) ) {
				getIpcApi().showNotification( {
					title: site.name,
					body: __( 'Staging site created' ),
				} );
				refreshWorkspaces();
				return;
			}

			getIpcApi().showErrorMessageBox( {
				title: __( 'Could not create staging site' ),
				message:
					result.payload?.message ??
					__( 'The staging site could not be created for this production site.' ),
			} );
		},
		[ dispatch, refreshWorkspaces ]
	);

	useEffect( () => {
		if ( ! productionSite?.id || ! stagingSite?.id ) {
			return;
		}

		void dispatch(
			stagingSyncThunks.fetchStagingSiteSyncState( { productionSiteId: productionSite.id } )
		);
	}, [ dispatch, productionSite?.id, stagingSite?.id ] );

	useEffect( () => {
		if ( ! productionSite?.id || ! stagingSite?.id || ! isEnvironmentSyncing ) {
			return;
		}

		const intervalId = window.setInterval( () => {
			void dispatch(
				stagingSyncThunks.fetchStagingSiteSyncState( { productionSiteId: productionSite.id } )
			);
		}, 3000 );

		return () => window.clearInterval( intervalId );
	}, [ dispatch, isEnvironmentSyncing, productionSite?.id, stagingSite?.id ] );

	if (
		! shouldShowLocalProductionRow &&
		! shouldShowLocalStagingRow &&
		! shouldShowEnvironmentRow
	) {
		return (
			<div className="p-8" data-testid="workspace-sync-panel">
				<div className="max-w-2xl rounded border border-a8c-gray-5 bg-white p-3 text-sm text-frame-text-secondary">
					{ __( 'No workspace sync links are available yet.' ) }
				</div>
			</div>
		);
	}

	return (
		<div className="p-8" data-testid="workspace-sync-panel">
			<div className="max-w-3xl">
				<h2 className="m-0 text-base font-medium text-frame-text">{ __( 'Sync' ) }</h2>
				<div className="mt-4 grid gap-3">
					{ shouldShowLocalProductionRow && (
						<LocalRemoteSyncRow
							label={ __( 'Local <-> Production' ) }
							localSite={ localSite }
							remoteSite={ productionSite }
							remoteTargetId="production"
							disabled={ isEnvironmentSyncing }
							active={ selectedTargetId === 'production' }
							onCreateLocalSite={ handleCreateLocalSite }
							onConnectRemoteSite={ handleConnectRemoteSite }
							isCreatingLocalSite={ creatingLocalSiteId === productionSite?.id }
							isConnectingSite={ connectingRemoteSiteId === productionSite?.id }
						/>
					) }
					{ shouldShowLocalStagingRow && (
						<LocalRemoteSyncRow
							label={ __( 'Local <-> Staging' ) }
							localSite={ localSite }
							remoteSite={ stagingSite }
							remoteTargetId="staging"
							disabled={ isEnvironmentSyncing }
							active={ selectedTargetId === 'staging' }
							onCreateLocalSite={ handleCreateLocalSite }
							onConnectRemoteSite={ handleConnectRemoteSite }
							isCreatingLocalSite={ creatingLocalSiteId === stagingSite?.id }
							isConnectingSite={ connectingRemoteSiteId === stagingSite?.id }
						/>
					) }
					{ shouldShowEnvironmentRow && (
						<EnvironmentSyncRow
							productionSite={ productionSite }
							stagingSite={ stagingSite }
							disabled={ isAnyLocalRemoteSyncing }
							active={ selectedTargetId === 'production' || selectedTargetId === 'staging' }
							onOpenDialog={ setEnvironmentSyncDirection }
							onCreateStagingSite={ handleCreateStagingSite }
							isCreatingStagingSite={ creatingStagingProductionSiteId === productionSite?.id }
						/>
					) }
				</div>
			</div>
			{ environmentSyncDirection && productionSite && stagingSite && (
				<EnvironmentSyncDialog
					direction={ environmentSyncDirection }
					productionSite={ productionSite }
					stagingSite={ stagingSite }
					onClose={ () => setEnvironmentSyncDirection( null ) }
				/>
			) }
		</div>
	);
}
