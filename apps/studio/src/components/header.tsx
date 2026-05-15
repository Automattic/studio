import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { SiteManagementActions } from 'src/components/site-management-actions';
import { useAuth } from 'src/hooks/use-auth';
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
	setSavedWpcomWorkspaceTarget,
} from 'src/modules/wpcom-site-assistant/lib/workspaces';
import { useCreateWpcomStagingSiteMutation } from 'src/stores/sync/wpcom-sites';

export default function Header() {
	const { __ } = useI18n();
	const {
		selectedSite: site,
		sites,
		startServer,
		stopServer,
		loadingServer,
		setSelectedWpcomSite,
		wpcomSites,
	} = useSiteDetails();
	const { client, isAuthenticated, user } = useAuth();
	const isOffline = useOffline();
	const [ createWpcomStagingSite, createWpcomStagingSiteResult ] =
		useCreateWpcomStagingSiteMutation();
	const isLoading = site?.id ? loadingServer[ site.id ] : false;
	const workspace = site ? getWpcomSiteWorkspaceForLocalSite( wpcomSites, site, sites ) : undefined;
	const productionSite = workspace?.productionSite;
	const stagingSite = workspace?.stagingSites[ 0 ];
	const stagingCreationBlocker = productionSite
		? getKnownStagingCreationBlocker( productionSite )
		: __( 'Production site details are not available yet.' );
	const hasMissingStagingSiteDetails = Boolean(
		productionSite?.stagingSiteIds?.length && ! stagingSite
	);
	const canCreateStagingSite =
		Boolean( productionSite ) &&
		! stagingSite &&
		! productionSite?.isStaging &&
		! productionSite?.isPressable &&
		! productionSite?.stagingSiteIds?.length &&
		! stagingCreationBlocker &&
		! isOffline &&
		isAuthenticated &&
		Boolean( client );
	const stagingTargetDisabledReason = stagingSite
		? undefined
		: createWpcomStagingSiteResult.isLoading
		? __( 'Creating staging site...' )
		: isOffline
		? __( 'Connect to the internet to create a staging site.' )
		: ! isAuthenticated || ! client
		? __( 'Log in to WordPress.com to create a staging site.' )
		: hasMissingStagingSiteDetails
		? __( 'Staging exists, but Studio could not load its details. Refresh WordPress.com sites.' )
		: stagingCreationBlocker;

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

	const createStagingSite = async () => {
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

	const selectWpcomSite = ( wpcomSite: NonNullable< typeof productionSite > ) => {
		if ( workspace ) {
			setSavedWpcomWorkspaceTarget( workspace.id, wpcomSite.id );
		}
		setSelectedWpcomSite( wpcomSite );
	};

	return (
		<div
			data-testid="site-content-header"
			className="flex justify-between items-start w-full gap-5 px-8"
		>
			{ site && (
				<div className="flex flex-col">
					<h1 className="text-xl font-medium max-h-full line-clamp-1 break-all">
						{ site ? site.name : null }
					</h1>
					<div className="flex mt-1 gap-x-4">
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
					{ workspace && (
						<div className="mt-3 flex items-center gap-2">
							<WorkspaceTargetSwitcher
								workspace={ workspace }
								selectedLocalSite={ site }
								onSelectWpcomSite={ selectWpcomSite }
								onSelectLocalSite={ () => undefined }
								onCreateStagingSite={ () => void createStagingSite() }
								canCreateStagingSite={ canCreateStagingSite }
								isCreatingStagingSite={ createWpcomStagingSiteResult.isLoading }
								stagingDisabledReason={ stagingTargetDisabledReason }
							/>
							<WorkspaceSyncControl workspace={ workspace } />
						</div>
					) }
				</div>
			) }
			<SiteManagementActions
				onStart={ startServer }
				loading={ isLoading }
				onStop={ stopServer }
				selectedSite={ site }
			/>
		</div>
	);
}
