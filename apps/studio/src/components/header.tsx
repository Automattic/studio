import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { SiteManagementActions } from 'src/components/site-management-actions';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { WorkspaceSyncControl } from 'src/modules/sync/components/workspace-sync-control';
import { WorkspaceTargetSwitcher } from 'src/modules/wpcom-site-assistant/components/workspace-target-switcher';
import {
	getKnownStagingCreationBlocker,
	getStagingCreationErrorMessage,
} from 'src/modules/wpcom-site-assistant/lib/staging';
import {
	getWpcomSiteWorkspaceForLocalSite,
	getWpcomSiteWorkspaceForSite,
	setSavedWpcomWorkspaceLocalTarget,
	setSavedWpcomWorkspaceTarget,
} from 'src/modules/wpcom-site-assistant/lib/workspaces';
import { useCreateWpcomStagingSiteMutation } from 'src/stores/sync/wpcom-sites';
import type { SyncSite } from '@studio/common/types/sync';
import type { ReactNode } from 'react';

type HeaderProps = {
	selectedWpcomSite?: SyncSite | null;
	rightControls?: ReactNode;
	onSelectWpcomSite?: ( site: SyncSite ) => void;
	onSelectLocalSite?: ( site: SiteDetails ) => void;
	onCreateStagingSite?: () => void;
	canCreateStagingSite?: boolean;
	isCreatingStagingSite?: boolean;
	stagingDisabledReason?: string;
};

export default function Header( {
	selectedWpcomSite: selectedWpcomSiteOverride,
	rightControls,
	onSelectWpcomSite,
	onSelectLocalSite,
	onCreateStagingSite,
	canCreateStagingSite: canCreateStagingSiteOverride,
	isCreatingStagingSite: isCreatingStagingSiteOverride,
	stagingDisabledReason: stagingDisabledReasonOverride,
}: HeaderProps = {} ) {
	const { __ } = useI18n();
	const {
		selectedSite: site,
		selectedWpcomSite,
		sites = [],
		startServer,
		stopServer,
		loadingServer,
		setSelectedSiteId,
		setSelectedWpcomSite,
		wpcomSites = [],
	} = useSiteDetails();
	const { client, isAuthenticated, user } = useAuth();
	const { enableWorkspaces } = useFeatureFlags();
	const isOffline = useOffline();
	const [ createWpcomStagingSite, createWpcomStagingSiteResult ] =
		useCreateWpcomStagingSiteMutation();
	const wpcomSite =
		selectedWpcomSiteOverride !== undefined
			? selectedWpcomSiteOverride
			: enableWorkspaces
			? selectedWpcomSite
			: undefined;
	const isLoading = site?.id ? loadingServer[ site.id ] : false;
	const workspace = wpcomSite
		? getWpcomSiteWorkspaceForSite( wpcomSites, wpcomSite, sites )
		: enableWorkspaces && site
		? getWpcomSiteWorkspaceForLocalSite( wpcomSites, site, sites )
		: undefined;
	const productionSite =
		workspace?.productionSite ?? ( wpcomSite && ! wpcomSite.isStaging ? wpcomSite : undefined );
	const stagingSite =
		workspace?.stagingSites[ 0 ] ?? ( wpcomSite?.isStaging ? wpcomSite : undefined );
	const stagingCreationBlocker = productionSite
		? getKnownStagingCreationBlocker( productionSite )
		: __( 'Production site details are not available yet.' );
	const hasMissingStagingSiteDetails = Boolean(
		productionSite?.stagingSiteIds?.length && ! stagingSite
	);
	const defaultCanCreateStagingSite =
		Boolean( productionSite ) &&
		! stagingSite &&
		! productionSite?.isStaging &&
		! productionSite?.isPressable &&
		! productionSite?.stagingSiteIds?.length &&
		! stagingCreationBlocker &&
		! isOffline &&
		isAuthenticated &&
		Boolean( client );
	const isCreatingStagingSite =
		isCreatingStagingSiteOverride ?? createWpcomStagingSiteResult.isLoading;
	const canCreateStagingSite = canCreateStagingSiteOverride ?? defaultCanCreateStagingSite;
	const defaultStagingTargetDisabledReason = stagingSite
		? undefined
		: isCreatingStagingSite
		? __( 'Creating staging site...' )
		: isOffline
		? __( 'Connect to the internet to create a staging site.' )
		: ! isAuthenticated || ! client
		? __( 'Log in to WordPress.com to create a staging site.' )
		: hasMissingStagingSiteDetails
		? __( 'Staging exists, but Studio could not load its details. Refresh WordPress.com sites.' )
		: stagingCreationBlocker;
	const stagingTargetDisabledReason =
		stagingDisabledReasonOverride ?? defaultStagingTargetDisabledReason;
	const displayTitle = wpcomSite?.name ?? site?.name;
	const shouldShowTargetSwitcher = Boolean(
		workspace || wpcomSite || ( enableWorkspaces && site )
	);

	const handleWpAdminClick = async () => {
		if ( ! site || isLoading ) return;

		if ( ! site.running ) {
			await startServer( site );
		}
		getIpcApi().openSiteURL( site.id, '/wp-admin/' );
	};

	const handleOpenSiteClick = async () => {
		if ( ! site || isLoading ) return;

		if ( ! site.running ) {
			await startServer( site );
		}
		getIpcApi().openSiteURL( site.id, '', { autoLogin: false } );
	};

	const createStagingSiteFromHeader = async () => {
		if ( ! productionSite || ! canCreateStagingSite ) {
			return;
		}

		try {
			const createdStagingSite = await createWpcomStagingSite( {
				site: productionSite,
				userId: user?.id,
			} ).unwrap();
			if ( workspace ) {
				setSavedWpcomWorkspaceTarget( workspace.id, createdStagingSite.id );
			}
			setSelectedWpcomSite( createdStagingSite );
		} catch ( error ) {
			getIpcApi().showErrorMessageBox( {
				title: __( 'Could not create staging site' ),
				message: getStagingCreationErrorMessage( error, productionSite ),
			} );
		}
	};

	const selectWpcomSiteFromHeader = ( wpcomSite: SyncSite ) => {
		if ( workspace ) {
			setSavedWpcomWorkspaceTarget( workspace.id, wpcomSite.id );
		}
		setSelectedWpcomSite( wpcomSite );
	};

	const selectLocalSiteFromHeader = ( localSite: SiteDetails ) => {
		if ( workspace ) {
			setSavedWpcomWorkspaceLocalTarget( workspace.id );
		}
		setSelectedSiteId( localSite.id );
	};

	const selectWpcomSite = onSelectWpcomSite ?? selectWpcomSiteFromHeader;
	const selectLocalSite = onSelectLocalSite ?? selectLocalSiteFromHeader;
	const createStagingSite = onCreateStagingSite ?? createStagingSiteFromHeader;

	return (
		<div
			data-testid="site-content-header"
			className="flex w-full items-start justify-between gap-5 px-8"
		>
			{ displayTitle && (
				<div className="flex min-w-0 flex-col">
					<h1 className="max-h-full break-all text-xl font-medium line-clamp-1">
						{ displayTitle }
					</h1>
					{ site && ! wpcomSite && (
						<div className="mt-1 flex gap-x-4">
							<Button
								className="[&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme !px-0 h-0 leading-4"
								onClick={ handleWpAdminClick }
								variant="link"
								disabled={ isLoading }
							>
								{ __( 'WP admin' ) }
								<ArrowIcon />
							</Button>
							<Button
								className="[&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme !px-0 h-0 leading-4"
								onClick={ handleOpenSiteClick }
								variant="link"
								disabled={ isLoading }
							>
								{
									// translators: "Open local site" refers to the action of opening the local site in a browser
									__( 'Open local site' )
								}
								<ArrowIcon />
							</Button>
						</div>
					) }
					{ shouldShowTargetSwitcher && (
						<div className="mt-3 flex items-center gap-2">
							<WorkspaceTargetSwitcher
								workspace={ workspace }
								selectedWpcomSite={ wpcomSite ?? undefined }
								selectedLocalSite={ wpcomSite ? null : site }
								onSelectWpcomSite={ selectWpcomSite }
								onSelectLocalSite={ selectLocalSite }
								onCreateStagingSite={ () => void createStagingSite() }
								canCreateStagingSite={ canCreateStagingSite }
								isCreatingStagingSite={ isCreatingStagingSite }
								stagingDisabledReason={ stagingTargetDisabledReason }
							/>
							{ workspace && <WorkspaceSyncControl workspace={ workspace } /> }
						</div>
					) }
				</div>
			) }
			{ rightControls ? (
				<div className="flex min-w-0 flex-1 justify-end">{ rightControls }</div>
			) : (
				! wpcomSite && (
					<SiteManagementActions
						onStart={ startServer }
						loading={ isLoading }
						onStop={ stopServer }
						selectedSite={ site }
					/>
				)
			) }
		</div>
	);
}
