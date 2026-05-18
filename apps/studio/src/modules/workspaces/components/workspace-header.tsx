import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { SiteManagementActions } from 'src/components/site-management-actions';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { StudioWorkspace } from 'src/modules/workspaces/types';

type WorkspaceHeaderProps = {
	workspace: StudioWorkspace;
	showLocalManagementActions?: boolean;
	onStartLocalSite?: ( site: SiteDetails ) => Promise< void >;
};

export function WorkspaceHeader( {
	workspace,
	showLocalManagementActions = false,
	onStartLocalSite,
}: WorkspaceHeaderProps ) {
	const { __ } = useI18n();
	const { startServer, stopServer, loadingServer } = useSiteDetails();
	const localSite = workspace.targets.local?.site;
	const isLoading = localSite?.id ? loadingServer[ localSite.id ] : false;
	const displayTitle = workspace.name || localSite?.name || __( 'Untitled workspace' );

	const handleLocalWpAdminClick = async () => {
		if ( ! localSite || isLoading ) {
			return;
		}
		if ( ! localSite.running ) {
			await startServer( localSite );
		}
		getIpcApi().openSiteURL( localSite.id, '/wp-admin/' );
	};

	const handleOpenLocalSiteClick = async () => {
		if ( ! localSite || isLoading ) {
			return;
		}
		if ( ! localSite.running ) {
			await startServer( localSite );
		}
		getIpcApi().openSiteURL( localSite.id, '', { autoLogin: false } );
	};

	return (
		<div
			data-testid="workspace-content-header"
			className="flex w-full items-stretch justify-between gap-5 px-8"
		>
			<div className="flex min-w-0 flex-col">
				<h1 className="max-h-full break-all text-xl font-medium line-clamp-1">{ displayTitle }</h1>
				<div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
					{ localSite && (
						<>
							<Button
								className="[&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme !px-0 h-0 leading-4"
								onClick={ handleLocalWpAdminClick }
								variant="link"
								disabled={ isLoading }
							>
								{ __( 'Local WP admin' ) }
								<ArrowIcon />
							</Button>
							<Button
								className="[&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme !px-0 h-0 leading-4"
								onClick={ handleOpenLocalSiteClick }
								variant="link"
								disabled={ isLoading }
							>
								{ __( 'Open local site' ) }
								<ArrowIcon />
							</Button>
						</>
					) }
				</div>
			</div>
			{ localSite && showLocalManagementActions && (
				<SiteManagementActions
					onStart={ onStartLocalSite ?? startServer }
					loading={ isLoading }
					onStop={ stopServer }
					selectedSite={ localSite }
				/>
			) }
		</div>
	);
}
