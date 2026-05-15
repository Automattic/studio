import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { SiteManagementActions } from 'src/components/site-management-actions';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { WorkspaceTargetSwitcher } from 'src/modules/workspaces/components/workspace-target-switcher';
import type {
	StudioWorkspace,
	WorkspaceTargetId,
	LocalTarget,
	RemoteTarget,
} from 'src/modules/workspaces/types';

type WorkspaceHeaderProps = {
	workspace: StudioWorkspace;
	selectedTargetId: WorkspaceTargetId;
	selectedTarget: LocalTarget | RemoteTarget;
	onSelectTarget: ( targetId: WorkspaceTargetId ) => void;
};

function resolveRemoteUrl( siteUrl: string, path = '/' ) {
	try {
		return new URL( path, siteUrl ).toString();
	} catch {
		return siteUrl;
	}
}

export function WorkspaceHeader( {
	workspace,
	selectedTargetId,
	selectedTarget,
	onSelectTarget,
}: WorkspaceHeaderProps ) {
	const { __ } = useI18n();
	const { startServer, stopServer, loadingServer } = useSiteDetails();
	const localSite = selectedTarget.kind === 'local' ? selectedTarget.site : undefined;
	const remoteSite = selectedTarget.kind === 'remote' ? selectedTarget.site : undefined;
	const isLoading = localSite?.id ? loadingServer[ localSite.id ] : false;
	const displayTitle = workspace.name || selectedTarget.site.name;

	const handleWpAdminClick = async () => {
		if ( localSite ) {
			if ( isLoading ) {
				return;
			}
			if ( ! localSite.running ) {
				await startServer( localSite );
			}
			getIpcApi().openSiteURL( localSite.id, '/wp-admin/' );
			return;
		}

		if ( remoteSite ) {
			getIpcApi().openURL( resolveRemoteUrl( remoteSite.url, '/wp-admin/' ) );
		}
	};

	const handleOpenSiteClick = async () => {
		if ( localSite ) {
			if ( isLoading ) {
				return;
			}
			if ( ! localSite.running ) {
				await startServer( localSite );
			}
			getIpcApi().openSiteURL( localSite.id, '', { autoLogin: false } );
			return;
		}

		if ( remoteSite ) {
			getIpcApi().openURL( remoteSite.url );
		}
	};

	return (
		<div
			data-testid="workspace-content-header"
			className="flex w-full items-stretch justify-between gap-5 px-8"
		>
			<div className="flex min-w-0 flex-col">
				<h1 className="max-h-full break-all text-xl font-medium line-clamp-1">{ displayTitle }</h1>
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
						{ localSite ? __( 'Open local site' ) : __( 'Open site' ) }
						<ArrowIcon />
					</Button>
				</div>
				<div className="mt-3">
					<WorkspaceTargetSwitcher
						workspace={ workspace }
						selectedTargetId={ selectedTargetId }
						onSelectTarget={ onSelectTarget }
					/>
				</div>
			</div>
			{ localSite && (
				<SiteManagementActions
					onStart={ startServer }
					loading={ isLoading }
					onStop={ stopServer }
					selectedSite={ localSite }
				/>
			) }
		</div>
	);
}
