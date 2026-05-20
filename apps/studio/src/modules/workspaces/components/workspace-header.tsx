import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { SiteManagementActions } from 'src/components/site-management-actions';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	WorkspacePreviewTargetPicker,
	type WorkspacePreviewTargetOption,
} from 'src/modules/workspaces/components/workspace-preview';
import type { StudioWorkspace, WorkspaceTargetId } from 'src/modules/workspaces/types';

type WorkspaceHeaderProps = {
	workspace: StudioWorkspace;
	showLocalManagementActions?: boolean;
	onStartLocalSite?: ( site: SiteDetails ) => Promise< void >;
	previewTargets?: WorkspacePreviewTargetOption[];
	selectedPreviewTargetId?: WorkspaceTargetId;
	onSelectPreviewTarget?: ( targetId: WorkspaceTargetId ) => void;
};

type WorkspaceHeaderLink = {
	id: string;
	label: string;
	onClick: () => void | Promise< void >;
	disabled?: boolean;
};

function resolveRemoteSiteUrl( siteUrl: string, path = '' ) {
	try {
		return new URL( path, siteUrl ).toString();
	} catch {
		return siteUrl;
	}
}

export function WorkspaceHeader( {
	workspace,
	showLocalManagementActions = false,
	onStartLocalSite,
	previewTargets = [],
	selectedPreviewTargetId,
	onSelectPreviewTarget,
}: WorkspaceHeaderProps ) {
	const { __ } = useI18n();
	const { startServer, stopServer, loadingServer } = useSiteDetails();
	const localSite = workspace.targets.local?.site;
	const isLoading = localSite?.id ? loadingServer[ localSite.id ] : false;
	const displayTitle = workspace.name || localSite?.name || __( 'Untitled workspace' );
	const showHeaderTargetPicker = Boolean(
		selectedPreviewTargetId && previewTargets.length && onSelectPreviewTarget
	);
	const selectedRemoteTarget =
		selectedPreviewTargetId === 'production'
			? workspace.targets.production
			: selectedPreviewTargetId === 'staging'
			? workspace.targets.staging
			: undefined;

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

	const headerLinks: WorkspaceHeaderLink[] = [];

	if ( selectedPreviewTargetId === 'local' && localSite ) {
		headerLinks.push(
			{
				id: 'local-admin',
				label: __( 'Local WP admin' ),
				onClick: handleLocalWpAdminClick,
				disabled: isLoading,
			},
			{
				id: 'local-site',
				label: __( 'Open local site' ),
				onClick: handleOpenLocalSiteClick,
				disabled: isLoading,
			}
		);
	} else if ( selectedRemoteTarget ) {
		const targetLabel =
			selectedRemoteTarget.id === 'production' ? __( 'Production' ) : __( 'Staging' );
		const openSiteLabel =
			selectedRemoteTarget.id === 'production'
				? __( 'Open production site' )
				: __( 'Open staging site' );
		headerLinks.push(
			{
				id: `${ selectedRemoteTarget.id }-admin`,
				label: sprintf(
					/* translators: %s is an environment name, such as Production or Staging. */
					__( '%s WP admin' ),
					targetLabel
				),
				onClick: () =>
					getIpcApi().openURL(
						resolveRemoteSiteUrl( selectedRemoteTarget.site.url, '/wp-admin/' )
					),
			},
			{
				id: `${ selectedRemoteTarget.id }-site`,
				label: openSiteLabel,
				onClick: () => getIpcApi().openURL( resolveRemoteSiteUrl( selectedRemoteTarget.site.url ) ),
			}
		);
	}

	return (
		<div
			data-testid="workspace-content-header"
			className="flex w-full items-stretch justify-between gap-5 px-8"
		>
			<div className="flex min-w-0 flex-col">
				<h1 className="max-h-full break-all text-xl font-medium line-clamp-1">{ displayTitle }</h1>
				<div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
					{ headerLinks.map( ( link ) => (
						<Button
							key={ link.id }
							className="[&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme !px-0 h-0 leading-4"
							onClick={ link.onClick }
							variant="link"
							disabled={ link.disabled }
						>
							{ link.label }
							<ArrowIcon />
						</Button>
					) ) }
				</div>
			</div>
			{ ( showHeaderTargetPicker || ( localSite && showLocalManagementActions ) ) && (
				<div className="flex shrink-0 items-start gap-3">
					{ showHeaderTargetPicker && selectedPreviewTargetId && onSelectPreviewTarget && (
						<WorkspacePreviewTargetPicker
							targets={ previewTargets }
							selectedTargetId={ selectedPreviewTargetId }
							onSelectTarget={ onSelectPreviewTarget }
							ariaLabel={ __( 'Workspace target' ) }
							variant="header"
						/>
					) }
					{ localSite && showLocalManagementActions && (
						<SiteManagementActions
							onStart={ onStartLocalSite ?? startServer }
							loading={ isLoading }
							onStop={ stopServer }
							selectedSite={ localSite }
						/>
					) }
				</div>
			) }
		</div>
	);
}
