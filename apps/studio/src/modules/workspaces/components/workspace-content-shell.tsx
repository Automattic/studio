import { TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useMemo, useState, type ComponentProps } from 'react';
import { ContentTabAssistant } from 'src/components/content-tab-assistant';
import { ContentTabImportExport } from 'src/components/content-tab-import-export';
import { ContentTabOverview } from 'src/components/content-tab-overview';
import { ContentTabPreviews } from 'src/components/content-tab-previews';
import { ContentTabSettings } from 'src/components/content-tab-settings';
import { SiteIsBeingCreated } from 'src/components/site-is-being-created';
import { MIN_WIDTH_CLASS_TO_MEASURE } from 'src/constants';
import { useContentTabs, type TabName } from 'src/hooks/use-content-tabs';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { cx } from 'src/lib/cx';
import { ContentTabSync } from 'src/modules/sync';
import {
	getDefaultWorkspaceTabId,
	getWorkspaceTabIds,
	useWorkspaceSelection,
} from 'src/modules/workspaces';
import { WorkspaceDollyAssistant } from 'src/modules/workspaces/components/workspace-dolly-assistant';
import { WorkspaceHeader } from 'src/modules/workspaces/components/workspace-header';
import {
	createDefaultWorkspacePreviewState,
	resolveWorkspacePreviewUrl,
	WorkspacePreviewControls,
	WorkspacePreviewPanel,
	type WorkspacePreviewState,
	type WorkspacePreviewTarget,
} from 'src/modules/workspaces/components/workspace-preview';
import type {
	RemoteTarget,
	StudioWorkspace,
	WorkspaceTargetId,
} from 'src/modules/workspaces/types';

type WorkspaceShellPreviewTarget = WorkspacePreviewTarget & {
	id: WorkspaceTargetId;
	targetId: WorkspaceTargetId;
	label: string;
	siteId?: number | string;
};

function EmptyWorkspaceSelection() {
	return (
		<div className="flex h-full w-full items-center justify-center app-no-drag-region">
			<p className="text-lg text-frame-text-secondary">
				{ __( 'Select a workspace to view details.' ) }
			</p>
		</div>
	);
}

function WorkspaceSyncPlaceholder( { workspace }: { workspace: StudioWorkspace } ) {
	return (
		<div className="p-8">
			<div className="max-w-2xl">
				<h2 className="m-0 text-base font-medium text-frame-text">{ __( 'Sync' ) }</h2>
				<div className="mt-4 grid gap-3">
					{ workspace.syncLinks.length ? (
						workspace.syncLinks.map( ( link ) => (
							<div
								key={ link.id }
								className="rounded border border-a8c-gray-5 bg-white p-3 text-sm text-frame-text"
							>
								{ link.source } &lt;-&gt; { link.target }
							</div>
						) )
					) : (
						<div className="rounded border border-a8c-gray-5 bg-white p-3 text-sm text-frame-text-secondary">
							{ __( 'No workspace sync links are available yet.' ) }
						</div>
					) }
				</div>
			</div>
		</div>
	);
}

function SettingsRow( { label, value }: { label: string; value?: string | number | null } ) {
	return (
		<div className="grid grid-cols-[10rem_1fr] gap-4 border-b border-a8c-gray-5 py-3 text-sm last:border-b-0">
			<div className="text-frame-text-secondary">{ label }</div>
			<div className="min-w-0 break-all text-frame-text">{ value || __( 'Unknown' ) }</div>
		</div>
	);
}

function WorkspaceSettingsPlaceholder( { workspace }: { workspace: StudioWorkspace } ) {
	const targets = [ workspace.targets.production, workspace.targets.staging ].filter(
		( target ): target is RemoteTarget => Boolean( target )
	);

	return (
		<div className="p-8">
			<div className="max-w-2xl">
				<h2 className="m-0 text-base font-medium text-frame-text">{ __( 'Settings' ) }</h2>
				<div className="mt-4 rounded border border-a8c-gray-5 bg-white px-4">
					<SettingsRow label={ __( 'Workspace' ) } value={ workspace.name } />
					{ targets.map( ( target ) => (
						<SettingsRow
							key={ target.id }
							label={ target.id === 'production' ? __( 'Production' ) : __( 'Staging' ) }
							value={ target.site.url }
						/>
					) ) }
				</div>
			</div>
		</div>
	);
}

function LocalOnlyWorkspaceTabNotice( { title }: { title: string } ) {
	return (
		<div className="flex h-full items-center justify-center bg-frame-surface p-8 text-center">
			<div className="max-w-sm">
				<h2 className="m-0 text-base font-medium text-frame-text">{ title }</h2>
				<p className="m-0 mt-2 text-sm text-frame-text-secondary">
					{ __( 'This section is managed in the Local target.' ) }
				</p>
			</div>
		</div>
	);
}

function getOrderedWorkspaceTabs(
	tabs: ComponentProps< typeof TabPanel >[ 'tabs' ],
	workspace: StudioWorkspace
) {
	const tabsByName = new Map( tabs.map( ( tab ) => [ tab.name, tab ] ) );
	return getWorkspaceTabIds( workspace )
		.map( ( tabId ) => tabsByName.get( tabId ) )
		.filter( ( tab ): tab is NonNullable< typeof tab > => Boolean( tab ) )
		.map( ( tab ) => ( {
			...tab,
			className: tab.className?.replace( /\s*ltr:ml-auto\s+rtl:mr-auto\s*/g, ' ' ).trim(),
		} ) );
}

function resolveLocalPreviewBaseUrl( site: SiteDetails ) {
	if ( site.running ) {
		return site.url;
	}

	const protocol = site.customDomain && site.enableHttps ? 'https' : 'http';
	const domain = site.customDomain || `localhost:${ site.port }`;

	return `${ protocol }://${ domain }`;
}

function getDefaultPreviewTargetId( workspace: StudioWorkspace ): WorkspaceTargetId | undefined {
	if ( workspace.targets.local ) {
		return 'local';
	}
	if ( workspace.targets.staging ) {
		return 'staging';
	}
	if ( workspace.targets.production ) {
		return 'production';
	}
}

function getUrlPath( url: URL ) {
	return `${ url.pathname }${ url.search }${ url.hash }` || '/';
}

function getTargetScopedPathOrUrl( pathOrUrl: string, targetSiteUrl: string ) {
	try {
		const requestedUrl = new URL( pathOrUrl );
		const targetUrl = new URL( targetSiteUrl );

		if ( requestedUrl.origin !== targetUrl.origin ) {
			return getUrlPath( requestedUrl );
		}
	} catch {
		return pathOrUrl;
	}

	return pathOrUrl;
}

function isCurrentUrlForTarget( currentUrl: string | undefined, targetSiteUrl: string ) {
	if ( ! currentUrl ) {
		return false;
	}

	try {
		return new URL( currentUrl ).origin === new URL( targetSiteUrl ).origin;
	} catch {
		return false;
	}
}

function getPreviewStateForTarget(
	previewState: WorkspacePreviewState,
	target: WorkspaceShellPreviewTarget
) {
	const pathOrUrl = getTargetScopedPathOrUrl( previewState.pathOrUrl, target.siteUrl );
	const currentUrl = isCurrentUrlForTarget( previewState.currentUrl, target.siteUrl )
		? previewState.currentUrl
		: undefined;

	if ( pathOrUrl === previewState.pathOrUrl && currentUrl === previewState.currentUrl ) {
		return previewState;
	}

	return {
		...previewState,
		pathOrUrl,
		currentUrl,
		canGoBack: currentUrl ? previewState.canGoBack : false,
		canGoForward: currentUrl ? previewState.canGoForward : false,
		navigationAction: currentUrl ? previewState.navigationAction : undefined,
	};
}

function getTransportTarget( workspace: StudioWorkspace ) {
	return workspace.targets.staging ?? workspace.targets.production;
}

export function WorkspaceContentShell() {
	const { tabs } = useContentTabs();
	const { importState } = useImportExport();
	const { loadingServer, siteCreationMessages, startServer } = useSiteDetails();
	const { selectedWorkspace, selectedTabId, selectWorkspaceTab } = useWorkspaceSelection();
	const [ previewStates, setPreviewStates ] = useState< Record< string, WorkspacePreviewState > >(
		{}
	);
	const [ selectedPreviewTargetIds, setSelectedPreviewTargetIds ] = useState<
		Record< string, WorkspaceTargetId >
	>( {} );

	const localTarget = selectedWorkspace?.targets.local;
	const transportTarget = selectedWorkspace ? getTransportTarget( selectedWorkspace ) : undefined;
	const previewKey = selectedWorkspace?.id ?? '';

	const previewTargets = useMemo< WorkspaceShellPreviewTarget[] >( () => {
		if ( ! selectedWorkspace ) {
			return [];
		}

		const targets: WorkspaceShellPreviewTarget[] = [];
		if ( selectedWorkspace.targets.local ) {
			const site = selectedWorkspace.targets.local.site;
			targets.push( {
				id: 'local',
				targetId: 'local',
				label: __( 'Local' ),
				siteId: site.id,
				siteName: site.name,
				siteUrl: resolveLocalPreviewBaseUrl( site ),
				isLoading: loadingServer[ site.id ],
				onShowPreview: async () => {
					if ( ! site.running ) {
						await startServer( site );
					}
				},
			} );
		}
		if ( selectedWorkspace.targets.staging ) {
			targets.push( {
				id: 'staging',
				targetId: 'staging',
				label: __( 'Staging' ),
				siteName: selectedWorkspace.targets.staging.site.name,
				siteUrl: selectedWorkspace.targets.staging.site.url,
				siteId: selectedWorkspace.targets.staging.site.id,
			} );
		}
		if ( selectedWorkspace.targets.production ) {
			targets.push( {
				id: 'production',
				targetId: 'production',
				label: __( 'Production' ),
				siteName: selectedWorkspace.targets.production.site.name,
				siteUrl: selectedWorkspace.targets.production.site.url,
				siteId: selectedWorkspace.targets.production.site.id,
				isProduction: true,
			} );
		}
		return targets;
	}, [ loadingServer, selectedWorkspace, startServer ] );
	const previewState = previewStates[ previewKey ] ?? createDefaultWorkspacePreviewState();
	const selectedPreviewTargetId = selectedWorkspace
		? selectedPreviewTargetIds[ selectedWorkspace.id ] ??
		  getDefaultPreviewTargetId( selectedWorkspace )
		: undefined;
	const previewTarget =
		previewTargets.find( ( target ) => target.id === selectedPreviewTargetId ) ??
		previewTargets[ 0 ];
	const workspaceTabs = useMemo(
		() => ( selectedWorkspace ? getOrderedWorkspaceTabs( tabs, selectedWorkspace ) : [] ),
		[ selectedWorkspace, tabs ]
	);

	if ( ! selectedWorkspace ) {
		return <EmptyWorkspaceSelection />;
	}

	if ( localTarget ) {
		const selectedSite = localTarget.site;
		const siteImportState = importState[ selectedSite.id ];
		const creationMessage = selectedSite.id ? siteCreationMessages[ selectedSite.id ] : undefined;

		if ( selectedSite.isAddingSite || siteImportState?.isNewSite ) {
			return (
				<SiteIsBeingCreated
					siteName={ selectedSite.name }
					statusMessage={ siteImportState?.statusMessage || creationMessage }
				/>
			);
		}
	}

	const activeTabId = selectedTabId ?? getDefaultWorkspaceTabId( selectedWorkspace );
	const targetPreviewState = previewTarget
		? getPreviewStateForTarget( previewState, previewTarget )
		: previewState;
	const resolvedPreviewUrl = previewTarget
		? resolveWorkspacePreviewUrl( previewTarget.siteUrl, targetPreviewState.pathOrUrl )
		: undefined;
	const previewUrl = targetPreviewState.currentUrl ?? resolvedPreviewUrl;
	const localContextSite = previewTarget?.id === 'local' ? localTarget?.site : undefined;

	const updatePreviewState = ( nextPreviewState: WorkspacePreviewState ) => {
		if ( ! previewKey ) {
			return;
		}

		setPreviewStates( ( current ) => ( {
			...current,
			[ previewKey ]: nextPreviewState,
		} ) );
	};

	const selectPreviewTarget = ( targetId: WorkspaceTargetId ) => {
		const target = previewTargets.find( ( candidate ) => candidate.id === targetId );
		setSelectedPreviewTargetIds( ( current ) => ( {
			...current,
			[ selectedWorkspace.id ]: targetId,
		} ) );
		setPreviewStates( ( current ) => {
			const currentPreviewState = current[ previewKey ] ?? createDefaultWorkspacePreviewState();
			const nextPreviewState = target
				? getPreviewStateForTarget( currentPreviewState, target )
				: currentPreviewState;
			return {
				...current,
				[ previewKey ]: {
					...nextPreviewState,
					canGoBack: false,
					canGoForward: false,
					currentUrl: undefined,
					navigationAction: undefined,
				},
			};
		} );
	};

	const updatePreviewNavigationState = (
		navigationState: Pick< WorkspacePreviewState, 'canGoBack' | 'canGoForward' | 'currentUrl' >
	) => {
		if ( ! previewKey ) {
			return;
		}

		setPreviewStates( ( current ) => {
			const currentPreviewState = current[ previewKey ] ?? createDefaultWorkspacePreviewState();
			const nextPreviewState = previewTarget
				? getPreviewStateForTarget( currentPreviewState, previewTarget )
				: currentPreviewState;

			if (
				nextPreviewState.canGoBack === navigationState.canGoBack &&
				nextPreviewState.canGoForward === navigationState.canGoForward &&
				nextPreviewState.currentUrl === navigationState.currentUrl
			) {
				return current;
			}

			return {
				...current,
				[ previewKey ]: {
					...nextPreviewState,
					...navigationState,
				},
			};
		} );
	};

	const openPreviewTarget = (
		targetId: WorkspaceTargetId,
		pathOrUrl = '/',
		nextPreviewState: WorkspacePreviewState
	) => {
		void pathOrUrl;
		const target = previewTargets.find( ( candidate ) => candidate.id === targetId );
		if ( ! target ) {
			return;
		}
		void target.onShowPreview?.();
		const nextTargetPreviewState = getPreviewStateForTarget( nextPreviewState, target );
		setSelectedPreviewTargetIds( ( current ) => ( {
			...current,
			[ selectedWorkspace.id ]: targetId,
		} ) );
		setPreviewStates( ( current ) => ( {
			...current,
			[ selectedWorkspace.id ]: nextTargetPreviewState,
		} ) );
	};

	const startLocalSiteFromHeader = async ( site: SiteDetails ) => {
		await startServer( site );
		if ( previewTarget?.id !== 'local' ) {
			return;
		}
		updatePreviewState( {
			...targetPreviewState,
			currentUrl: resolveWorkspacePreviewUrl( previewTarget.siteUrl, targetPreviewState.pathOrUrl ),
			reloadNonce: targetPreviewState.reloadNonce + 1,
		} );
	};

	return (
		<div className="flex h-full min-h-0 w-full flex-col app-no-drag-region overflow-hidden pt-8">
			<WorkspaceHeader
				workspace={ selectedWorkspace }
				showLocalManagementActions={ previewTarget?.id === 'local' }
				onStartLocalSite={ startLocalSiteFromHeader }
			/>
			<div
				data-testid="workspace-content-body"
				className="relative mt-4 flex min-h-0 flex-1 overflow-hidden"
			>
				{ previewTarget && (
					<div
						data-testid="workspace-preview-controls"
						className="pointer-events-none absolute right-0 top-0 z-10 flex h-12 min-w-0 items-center justify-end border-l border-a8c-gray-5 bg-white px-3"
						style={ {
							width: targetPreviewState.width,
						} }
					>
						<div className="pointer-events-auto w-full min-w-0">
							<WorkspacePreviewControls
								target={ previewTarget }
								targets={ previewTargets }
								selectedTargetId={ previewTarget.id }
								previewState={ targetPreviewState }
								onSelectTarget={ selectPreviewTarget }
								onUpdatePreviewState={ updatePreviewState }
							/>
						</div>
					</div>
				) }
				<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
					<TabPanel
						className={ `flex h-full flex-col overflow-hidden ${ MIN_WIDTH_CLASS_TO_MEASURE }` }
						tabs={ workspaceTabs }
						orientation="horizontal"
						onSelect={ ( tabName ) =>
							selectWorkspaceTab( selectedWorkspace.id, tabName as TabName )
						}
						initialTabName={ activeTabId }
						key={ selectedWorkspace.id }
					>
						{ ( { name } ) => (
							<div
								className={ cx(
									'h-full overflow-y-auto',
									name === 'assistant' && 'bg-frame-surface'
								) }
								style={ {
									scrollbarWidth: 'thin',
									scrollbarGutter: 'stable',
								} }
							>
								{ name === 'overview' &&
									( localContextSite ? (
										<ContentTabOverview selectedSite={ localContextSite } />
									) : (
										<LocalOnlyWorkspaceTabNotice title={ __( 'Overview' ) } />
									) ) }
								{ name === 'previews' &&
									( localContextSite ? (
										<ContentTabPreviews selectedSite={ localContextSite } />
									) : (
										<LocalOnlyWorkspaceTabNotice title={ __( 'Previews' ) } />
									) ) }
								{ name === 'import-export' &&
									( localContextSite ? (
										<ContentTabImportExport selectedSite={ localContextSite } />
									) : (
										<LocalOnlyWorkspaceTabNotice title={ __( 'Import / Export' ) } />
									) ) }
								{ name === 'sync' &&
									( localContextSite ? (
										<ContentTabSync selectedSite={ localContextSite } />
									) : (
										<WorkspaceSyncPlaceholder workspace={ selectedWorkspace } />
									) ) }
								{ name === 'settings' &&
									( localContextSite ? (
										<ContentTabSettings selectedSite={ localContextSite } />
									) : (
										<WorkspaceSettingsPlaceholder workspace={ selectedWorkspace } />
									) ) }
								{ name === 'assistant' &&
									( localContextSite ? (
										<ContentTabAssistant selectedSite={ localContextSite } />
									) : transportTarget ? (
										<WorkspaceDollyAssistant
											workspace={ selectedWorkspace }
											transportTarget={ transportTarget }
											previewState={ targetPreviewState }
											previewTargetId={ previewTarget?.id }
											previewTargets={ previewTargets }
											onOpenPreviewTarget={ openPreviewTarget }
										/>
									) : localTarget ? (
										<ContentTabAssistant selectedSite={ localTarget.site } />
									) : null ) }
							</div>
						) }
					</TabPanel>
				</div>
				{ previewTarget && targetPreviewState.open && previewUrl && (
					<WorkspacePreviewPanel
						siteName={ previewTarget.siteName }
						previewUrl={ previewUrl }
						reloadNonce={ targetPreviewState.reloadNonce }
						width={ targetPreviewState.width }
						navigationAction={ targetPreviewState.navigationAction }
						navigationActionId={ targetPreviewState.navigationActionId }
						onResize={ ( width ) => updatePreviewState( { ...targetPreviewState, width } ) }
						onNavigationStateChange={ updatePreviewNavigationState }
					/>
				) }
			</div>
		</div>
	);
}
