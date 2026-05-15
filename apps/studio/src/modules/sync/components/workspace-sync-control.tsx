import { CheckboxControl, Icon, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { cautionFilled, cloudDownload, cloudUpload } from '@wordpress/icons';
import { useEffect, useState } from 'react';
import Button from 'src/components/button';
import Modal from 'src/components/modal';
import { Tooltip } from 'src/components/tooltip';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SyncConnectedSiteControls } from 'src/modules/sync/components/sync-connected-sites';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync';
import {
	STAGING_SYNC_OPTION_TOKENS,
	stagingSyncSelectors,
	stagingSyncThunks,
	type StagingSyncDirection,
	type StagingSyncOption,
} from 'src/stores/sync/staging-sync-slice';
import type { SyncSite } from '@studio/common/types/sync';
import type { WpcomSiteWorkspace } from 'src/modules/wpcom-site-assistant/lib/workspaces';

type WorkspaceSyncControlProps = {
	workspace?: WpcomSiteWorkspace;
};

type WorkspaceSyncPanelProps = {
	workspace?: WpcomSiteWorkspace;
	onClose: () => void;
};

type WorkspaceSyncPanelContentProps = {
	workspace?: WpcomSiteWorkspace;
};

type WorkspaceSyncRowsProps = {
	workspace?: WpcomSiteWorkspace;
	onOpenEnvironmentSync: ( direction: StagingSyncDirection ) => void;
};

type EnvironmentSyncDialogProps = {
	direction: StagingSyncDirection;
	productionSite: SyncSite;
	stagingSite: SyncSite;
	onClose: () => void;
};

const SYNC_OPTION_LABELS: Record< StagingSyncOption, string > = {
	sqls: __( 'Database' ),
	themes: __( 'Themes' ),
	plugins: __( 'Plugins' ),
	uploads: __( 'Uploads' ),
};

const getDefaultEnvironmentSyncOptions = ( direction: StagingSyncDirection ) =>
	direction === 'push'
		? [ ...STAGING_SYNC_OPTION_TOKENS ]
		: STAGING_SYNC_OPTION_TOKENS.filter( ( option ) => option !== 'sqls' );

function isRemoteConnectedToLocal( remoteSite: SyncSite | undefined, localSite?: SiteDetails ) {
	return Boolean( remoteSite && localSite && remoteSite.localSiteId === localSite.id );
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
	const dispatch = useAppDispatch();
	const [ selectedOptions, setSelectedOptions ] = useState< StagingSyncOption[] >(
		getDefaultEnvironmentSyncOptions( direction )
	);
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	const isPull = direction === 'pull';
	const title = isPull ? __( 'Pull staging to production' ) : __( 'Push production to staging' );
	const actionLabel = isPull ? __( 'Pull to Production' ) : __( 'Push to Staging' );
	const sourceSite = isPull ? stagingSite : productionSite;
	const destinationSite = isPull ? productionSite : stagingSite;

	const toggleOption = ( option: StagingSyncOption ) => {
		setSelectedOptions( ( currentOptions ) =>
			currentOptions.includes( option )
				? currentOptions.filter( ( currentOption ) => currentOption !== option )
				: [ ...currentOptions, option ]
		);
	};

	const confirmPullToProduction = async () => {
		if ( ! isPull ) {
			return true;
		}

		const includesDatabase = selectedOptions.includes( 'sqls' );
		const { response } = await getIpcApi().showMessageBox( {
			message: __( 'Pull staging changes to production?' ),
			detail: includesDatabase
				? __(
						'This will copy the selected staging content to production. The production database will be overwritten.'
				  )
				: __( 'This will copy the selected staging content to production.' ),
			buttons: [ __( 'Pull to Production' ), __( 'Cancel' ) ],
			cancelId: 1,
		} );

		return response === 0;
	};

	const runEnvironmentSync = async ( allowWooSync = false ) => {
		if ( selectedOptions.length === 0 ) {
			return;
		}

		if ( ! allowWooSync && ! ( await confirmPullToProduction() ) ) {
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
		if (
			isPull &&
			selectedOptions.includes( 'sqls' ) &&
			error?.code === 'rest_sqls_option_not_supported'
		) {
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
		<Modal title={ title } onRequestClose={ onClose } className="w-[520px]">
			<div className="flex flex-col gap-5 p-2">
				<div className="text-sm text-frame-text-secondary">
					{ sourceSite.name } → { destinationSite.name }
				</div>
				{ isPull && (
					<div className="flex gap-2 rounded border border-yellow-400/50 bg-yellow-50/10 p-3 text-sm text-frame-text">
						<Icon icon={ cautionFilled } size={ 18 } />
						<div>
							{ __(
								'This changes production. Review the selected content carefully before continuing.'
							) }
						</div>
					</div>
				) }
				<div className="grid gap-2">
					{ STAGING_SYNC_OPTION_TOKENS.map( ( option ) => (
						<CheckboxControl
							key={ option }
							label={ SYNC_OPTION_LABELS[ option ] }
							checked={ selectedOptions.includes( option ) }
							onChange={ () => toggleOption( option ) }
						/>
					) ) }
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="tertiary" onClick={ onClose } disabled={ isSubmitting }>
						{ __( 'Cancel' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ () => void runEnvironmentSync() }
						disabled={ isSubmitting || selectedOptions.length === 0 }
					>
						{ actionLabel }
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function LocalRemoteSyncRow( {
	label,
	localSite,
	remoteSite,
	disabled,
}: {
	label: string;
	localSite?: SiteDetails;
	remoteSite?: SyncSite;
	disabled?: boolean;
} ) {
	const isConnected = isRemoteConnectedToLocal( remoteSite, localSite );

	return (
		<div className="grid grid-cols-[1fr_auto] items-center gap-4 rounded border border-a8c-gray-5 bg-white p-3">
			<div className="min-w-0">
				<div className="text-sm font-medium text-frame-text">{ label }</div>
				<div className="truncate text-xs text-frame-text-secondary">
					{ isConnected && remoteSite
						? remoteSite.url
						: __( 'Connect this target to the local site from the Sync tab.' ) }
				</div>
			</div>
			<div className={ cx( disabled && 'opacity-50' ) }>
				{ isConnected && localSite && remoteSite ? (
					<SyncConnectedSiteControls
						connectedSite={ remoteSite }
						selectedSite={ localSite }
						disabled={ disabled }
						disabledReason={ __( 'Wait for the environment sync to finish.' ) }
					/>
				) : (
					<Button variant="tertiary" disabled>
						{ __( 'Not connected' ) }
					</Button>
				) }
			</div>
		</div>
	);
}

function EnvironmentSyncRow( {
	productionSite,
	stagingSite,
	disabled,
	onOpenDialog,
}: {
	productionSite?: SyncSite;
	stagingSite?: SyncSite;
	disabled: boolean;
	onOpenDialog: ( direction: StagingSyncDirection ) => void;
} ) {
	const stagingSyncState = useRootSelector(
		stagingSyncSelectors.selectState( productionSite?.id )
	);
	const isEnvironmentSyncing = useRootSelector(
		stagingSyncSelectors.selectIsProductionSiteSyncing( productionSite?.id )
	);
	const disabledReason =
		! productionSite || ! stagingSite
			? __( 'Production and staging site details are required before syncing environments.' )
			: undefined;

	return (
		<div className="grid grid-cols-[1fr_auto] items-center gap-4 rounded border border-a8c-gray-5 bg-white p-3">
			<div className="min-w-0">
				<div className="text-sm font-medium text-frame-text">{ __( 'Production ↔ Staging' ) }</div>
				<div className="truncate text-xs text-frame-text-secondary">
					{ stagingSyncState?.status === 'failed'
						? stagingSyncState.error?.message ?? __( 'Environment sync failed.' )
						: isEnvironmentSyncing
						? __( 'Environment sync is running.' )
						: stagingSyncState?.status === 'completed'
						? __( 'Last environment sync completed.' )
						: __( 'Copy content between production and staging.' ) }
				</div>
			</div>
			<Tooltip text={ disabledReason } disabled={ ! disabledReason } placement="top-start">
				<div className="flex items-center gap-2">
					{ isEnvironmentSyncing && <Spinner className="!m-0 !h-4 !w-4" /> }
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
				</div>
			</Tooltip>
		</div>
	);
}

function WorkspaceSyncRows( { workspace, onOpenEnvironmentSync }: WorkspaceSyncRowsProps ) {
	const dispatch = useAppDispatch();
	const localSite = workspace?.localSite;
	const productionSite = workspace?.productionSite;
	const stagingSite = workspace?.stagingSites[ 0 ];
	const localProductionSyncState = useLocalRemoteSyncState( localSite, productionSite );
	const localStagingSyncState = useLocalRemoteSyncState( localSite, stagingSite );
	const isEnvironmentSyncing = useRootSelector(
		stagingSyncSelectors.selectIsProductionSiteSyncing( productionSite?.id )
	);
	const isAnyLocalRemoteSyncing =
		localProductionSyncState.isSyncing || localStagingSyncState.isSyncing;
	const isEnvironmentSyncDisabled = ! productionSite || ! stagingSite || isAnyLocalRemoteSyncing;

	useEffect( () => {
		if ( ! productionSite?.id ) {
			return;
		}

		void dispatch(
			stagingSyncThunks.fetchStagingSiteSyncState( { productionSiteId: productionSite.id } )
		);
	}, [ dispatch, productionSite?.id ] );

	if ( ! workspace || ( ! localSite && ! productionSite && ! stagingSite ) ) {
		return null;
	}

	return (
		<div className="grid gap-3 p-2">
			{ localSite && (
				<LocalRemoteSyncRow
					label={ __( 'Local ↔ Production' ) }
					localSite={ localSite }
					remoteSite={ productionSite }
					disabled={ isEnvironmentSyncing }
				/>
			) }
			{ localSite && (
				<LocalRemoteSyncRow
					label={ __( 'Local ↔ Staging' ) }
					localSite={ localSite }
					remoteSite={ stagingSite }
					disabled={ isEnvironmentSyncing }
				/>
			) }
			<EnvironmentSyncRow
				productionSite={ productionSite }
				stagingSite={ stagingSite }
				disabled={ isEnvironmentSyncDisabled }
				onOpenDialog={ onOpenEnvironmentSync }
			/>
		</div>
	);
}

export function WorkspaceSyncPanelContent( { workspace }: WorkspaceSyncPanelContentProps ) {
	const [ environmentSyncDirection, setEnvironmentSyncDirection ] =
		useState< StagingSyncDirection | null >( null );
	const productionSite = workspace?.productionSite;
	const stagingSite = workspace?.stagingSites[ 0 ];

	return (
		<>
			<WorkspaceSyncRows
				workspace={ workspace }
				onOpenEnvironmentSync={ setEnvironmentSyncDirection }
			/>
			{ environmentSyncDirection && productionSite && stagingSite && (
				<EnvironmentSyncDialog
					direction={ environmentSyncDirection }
					productionSite={ productionSite }
					stagingSite={ stagingSite }
					onClose={ () => setEnvironmentSyncDirection( null ) }
				/>
			) }
		</>
	);
}

export function WorkspaceSyncPanel( { workspace, onClose }: WorkspaceSyncPanelProps ) {
	const [ environmentSyncDirection, setEnvironmentSyncDirection ] =
		useState< StagingSyncDirection | null >( null );
	const productionSite = workspace?.productionSite;
	const stagingSite = workspace?.stagingSites[ 0 ];

	return (
		<>
			<Modal title={ __( 'Workspace sync' ) } onRequestClose={ onClose } className="w-[680px]">
				<WorkspaceSyncRows
					workspace={ workspace }
					onOpenEnvironmentSync={ setEnvironmentSyncDirection }
				/>
			</Modal>
			{ environmentSyncDirection && productionSite && stagingSite && (
				<EnvironmentSyncDialog
					direction={ environmentSyncDirection }
					productionSite={ productionSite }
					stagingSite={ stagingSite }
					onClose={ () => setEnvironmentSyncDirection( null ) }
				/>
			) }
		</>
	);
}

export function WorkspaceSyncControl( { workspace }: WorkspaceSyncControlProps ) {
	const [ isPanelOpen, setIsPanelOpen ] = useState( false );
	const localSite = workspace?.localSite;
	const productionSite = workspace?.productionSite;
	const stagingSite = workspace?.stagingSites[ 0 ];
	const localProductionSyncState = useLocalRemoteSyncState( localSite, productionSite );
	const localStagingSyncState = useLocalRemoteSyncState( localSite, stagingSite );
	const isEnvironmentSyncing = useRootSelector(
		stagingSyncSelectors.selectIsProductionSiteSyncing( productionSite?.id )
	);
	const isAnyLocalRemoteSyncing =
		localProductionSyncState.isSyncing || localStagingSyncState.isSyncing;

	if ( ! workspace || ( ! localSite && ! productionSite && ! stagingSite ) ) {
		return null;
	}

	return (
		<>
			<Button
				variant="tertiary"
				className="h-8 whitespace-nowrap"
				onClick={ () => setIsPanelOpen( true ) }
			>
				{ isEnvironmentSyncing || isAnyLocalRemoteSyncing ? (
					<Spinner className="!m-0 !h-3 !w-3" />
				) : null }
				{ __( 'Sync' ) }
			</Button>
			{ isPanelOpen && (
				<WorkspaceSyncPanel workspace={ workspace } onClose={ () => setIsPanelOpen( false ) } />
			) }
		</>
	);
}
