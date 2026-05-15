import { TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
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
	getDefaultWorkspaceTargetTabId,
	getWorkspaceTargetTabIds,
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
import type { SyncSite } from '@studio/common/types/sync';
import type {
	RemoteTarget,
	StudioWorkspace,
	WorkspaceTargetId,
} from 'src/modules/workspaces/types';

function EmptyWorkspaceSelection() {
	return (
		<div className="flex h-full w-full items-center justify-center app-no-drag-region">
			<p className="text-lg text-frame-text-secondary">
				{ __( 'Select a workspace to view details.' ) }
			</p>
		</div>
	);
}

function RemoteSyncPlaceholder( {
	workspace,
	target,
}: {
	workspace: StudioWorkspace;
	target: RemoteTarget;
} ) {
	const syncLinksForTarget = workspace.syncLinks.filter(
		( link ) => link.source === target.id || link.target === target.id
	);

	return (
		<div className="p-8">
			<div className="max-w-2xl">
				<h2 className="m-0 text-base font-medium text-frame-text">{ __( 'Sync' ) }</h2>
				<div className="mt-4 grid gap-3">
					{ syncLinksForTarget.length ? (
						syncLinksForTarget.map( ( link ) => (
							<div
								key={ link.id }
								className="rounded border border-a8c-gray-5 bg-white p-3 text-sm text-frame-text"
							>
								{ link.source } &lt;-&gt; { link.target }
							</div>
						) )
					) : (
						<div className="rounded border border-a8c-gray-5 bg-white p-3 text-sm text-frame-text-secondary">
							{ __( 'No workspace sync links are available for this target.' ) }
						</div>
					) }
				</div>
			</div>
		</div>
	);
}

function SettingsRow( { label, value }: { label: string; value?: string | number | null } ) {
	return (
		<div className="grid grid-cols-[10rem_1fr] gap-4 border-b border-a8c-gray-5 py-3 text-sm">
			<div className="text-frame-text-secondary">{ label }</div>
			<div className="min-w-0 break-all text-frame-text">{ value || __( 'Unknown' ) }</div>
		</div>
	);
}

function RemoteSettings( { site }: { site: SyncSite } ) {
	return (
		<div className="p-8">
			<div className="max-w-2xl">
				<h2 className="m-0 text-base font-medium text-frame-text">{ __( 'Settings' ) }</h2>
				<div className="mt-4 rounded border border-a8c-gray-5 bg-white px-4">
					<SettingsRow
						label={ __( 'Environment' ) }
						value={ site.isStaging ? __( 'Staging' ) : __( 'Production' ) }
					/>
					<SettingsRow label={ __( 'Site name' ) } value={ site.name } />
					<SettingsRow label={ __( 'Site URL' ) } value={ site.url } />
					<SettingsRow label={ __( 'WordPress.com site ID' ) } value={ site.id } />
				</div>
			</div>
		</div>
	);
}

function getOrderedWorkspaceTabs(
	tabs: ComponentProps< typeof TabPanel >[ 'tabs' ],
	targetId: WorkspaceTargetId
) {
	const tabsByName = new Map( tabs.map( ( tab ) => [ tab.name, tab ] ) );
	return getWorkspaceTargetTabIds( targetId )
		.map( ( tabId ) => tabsByName.get( tabId ) )
		.filter( ( tab ): tab is NonNullable< typeof tab > => Boolean( tab ) )
		.map( ( tab ) => ( {
			...tab,
			className: tab.className?.replace( /\s*ltr:ml-auto\s+rtl:mr-auto\s*/g, ' ' ).trim(),
		} ) );
}

function renderRemoteTabContent( {
	workspace,
	target,
	name,
	previewState,
	onUpdatePreviewState,
}: {
	workspace: StudioWorkspace;
	target: RemoteTarget;
	name: TabName;
	previewState: WorkspacePreviewState;
	onUpdatePreviewState: ( state: WorkspacePreviewState ) => void;
} ) {
	if ( name === 'assistant' ) {
		return (
			<WorkspaceDollyAssistant
				workspace={ workspace }
				target={ target }
				previewState={ previewState }
				onUpdatePreviewState={ onUpdatePreviewState }
			/>
		);
	}

	if ( name === 'sync' ) {
		return <RemoteSyncPlaceholder workspace={ workspace } target={ target } />;
	}

	if ( name === 'settings' ) {
		return <RemoteSettings site={ target.site } />;
	}

	return null;
}

function resolveLocalPreviewBaseUrl( site: SiteDetails ) {
	if ( site.running ) {
		return site.url;
	}

	const protocol = site.customDomain && site.enableHttps ? 'https' : 'http';
	const domain = site.customDomain || `localhost:${ site.port }`;

	return `${ protocol }://${ domain }`;
}

export function WorkspaceContentShell() {
	const { tabs } = useContentTabs();
	const { importState } = useImportExport();
	const { loadingServer, siteCreationMessages, startServer } = useSiteDetails();
	const {
		selectedWorkspace,
		selectedTarget,
		selectedTargetId,
		selectedTabId,
		selectWorkspaceTarget,
		selectWorkspaceTab,
	} = useWorkspaceSelection();
	const [ previewStates, setPreviewStates ] = useState< Record< string, WorkspacePreviewState > >(
		{}
	);

	const workspaceTabs = useMemo(
		() => ( selectedTargetId ? getOrderedWorkspaceTabs( tabs, selectedTargetId ) : [] ),
		[ selectedTargetId, tabs ]
	);
	const previewKey =
		selectedWorkspace && selectedTargetId ? `${ selectedWorkspace.id }:${ selectedTargetId }` : '';

	const updatePreviewState = useCallback(
		( nextPreviewState: WorkspacePreviewState ) => {
			if ( ! previewKey ) {
				return;
			}

			setPreviewStates( ( current ) => ( {
				...current,
				[ previewKey ]: nextPreviewState,
			} ) );
		},
		[ previewKey ]
	);

	const updatePreviewNavigationState = useCallback(
		(
			navigationState: Pick< WorkspacePreviewState, 'canGoBack' | 'canGoForward' | 'currentUrl' >
		) => {
			if ( ! previewKey ) {
				return;
			}

			setPreviewStates( ( current ) => {
				const currentPreviewState = current[ previewKey ] ?? createDefaultWorkspacePreviewState();

				if (
					currentPreviewState.canGoBack === navigationState.canGoBack &&
					currentPreviewState.canGoForward === navigationState.canGoForward &&
					currentPreviewState.currentUrl === navigationState.currentUrl
				) {
					return current;
				}

				return {
					...current,
					[ previewKey ]: {
						...currentPreviewState,
						...navigationState,
					},
				};
			} );
		},
		[ previewKey ]
	);

	if ( ! selectedWorkspace || ! selectedTarget || ! selectedTargetId ) {
		return <EmptyWorkspaceSelection />;
	}

	if ( selectedTarget.kind === 'local' ) {
		const selectedSite = selectedTarget.site;
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

	const activeTabId = selectedTabId ?? getDefaultWorkspaceTargetTabId( selectedTargetId );
	const previewState = previewStates[ previewKey ] ?? createDefaultWorkspacePreviewState();
	const remoteTarget = selectedTarget.kind === 'remote' ? selectedTarget : undefined;
	const localTarget = selectedTarget.kind === 'local' ? selectedTarget : undefined;
	let previewTarget: WorkspacePreviewTarget | undefined;
	if ( remoteTarget ) {
		previewTarget = {
			siteName: remoteTarget.site.name,
			siteUrl: remoteTarget.site.url,
		};
	} else if ( localTarget ) {
		previewTarget = {
			siteName: localTarget.site.name,
			siteUrl: resolveLocalPreviewBaseUrl( localTarget.site ),
			isLoading: loadingServer[ localTarget.site.id ],
			onShowPreview: async () => {
				if ( ! localTarget.site.running ) {
					await startServer( localTarget.site );
				}
			},
		};
	}
	const resolvedPreviewUrl = previewTarget
		? resolveWorkspacePreviewUrl( previewTarget.siteUrl, previewState.pathOrUrl )
		: undefined;
	const previewUrl = previewState.currentUrl ?? resolvedPreviewUrl;

	return (
		<div className="flex h-full min-h-0 w-full flex-col app-no-drag-region overflow-hidden pt-8">
			<WorkspaceHeader
				workspace={ selectedWorkspace }
				selectedTargetId={ selectedTargetId }
				selectedTarget={ selectedTarget }
				onSelectTarget={ ( targetId ) => selectWorkspaceTarget( selectedWorkspace.id, targetId ) }
			/>
			<div
				data-testid="workspace-content-body"
				className="relative mt-4 flex min-h-0 flex-1 overflow-hidden"
			>
				{ previewTarget && (
					<div
						data-testid="workspace-preview-controls"
						className="pointer-events-none absolute right-8 top-0 z-10 flex h-10 min-w-0 items-center justify-end"
						style={ {
							width: Math.max( previewState.width - 64, 260 ),
						} }
					>
						<div className="pointer-events-auto w-full min-w-0">
							<WorkspacePreviewControls
								target={ previewTarget }
								previewState={ previewState }
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
							selectWorkspaceTab( selectedWorkspace.id, selectedTargetId, tabName as TabName )
						}
						initialTabName={ activeTabId }
						key={ `${ selectedWorkspace.id }-${ selectedTargetId }` }
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
								{ selectedTarget.kind === 'local' && (
									<>
										{ name === 'overview' && (
											<ContentTabOverview selectedSite={ selectedTarget.site } />
										) }
										{ name === 'previews' && (
											<ContentTabPreviews selectedSite={ selectedTarget.site } />
										) }
										{ name === 'sync' && <ContentTabSync selectedSite={ selectedTarget.site } /> }
										{ name === 'settings' && (
											<ContentTabSettings selectedSite={ selectedTarget.site } />
										) }
										{ name === 'assistant' && (
											<ContentTabAssistant selectedSite={ selectedTarget.site } />
										) }
										{ name === 'import-export' && (
											<ContentTabImportExport selectedSite={ selectedTarget.site } />
										) }
									</>
								) }
								{ remoteTarget &&
									renderRemoteTabContent( {
										workspace: selectedWorkspace,
										target: remoteTarget,
										name: name as TabName,
										previewState,
										onUpdatePreviewState: updatePreviewState,
									} ) }
							</div>
						) }
					</TabPanel>
				</div>
				{ previewTarget && previewState.open && previewUrl && (
					<WorkspacePreviewPanel
						siteName={ previewTarget.siteName }
						previewUrl={ previewUrl }
						reloadNonce={ previewState.reloadNonce }
						width={ previewState.width }
						navigationAction={ previewState.navigationAction }
						navigationActionId={ previewState.navigationActionId }
						onResize={ ( width ) => updatePreviewState( { ...previewState, width } ) }
						onNavigationStateChange={ updatePreviewNavigationState }
					/>
				) }
			</div>
		</div>
	);
}
