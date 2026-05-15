import * as Sentry from '@sentry/electron/renderer';
import { speak } from '@wordpress/a11y';
import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useMemo, useState } from 'react';
import { XDebugIcon } from 'src/components/icons/xdebug-icon';
import { Tooltip } from 'src/components/tooltip';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useCreateLocalSiteFromRemote } from 'src/hooks/use-create-local-site-from-remote';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isMac, isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { WorkspaceSyncPanel } from 'src/modules/sync/components/workspace-sync-control';
import { CONNECTED_WPCOM_SITES_UPDATED_EVENT } from 'src/modules/sync/lib/connected-sites-events';
import {
	canCreateLocalSiteFromRemote,
	getSyncSupportActionUrl,
	getSyncSupportDescription,
	getSyncSupportTitle,
} from 'src/modules/sync/lib/sync-support-ui';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import {
	WorkspaceSidebarCommandMenu,
	type WorkspaceSidebarCommandMenuContext,
} from 'src/modules/wpcom-site-assistant/components/workspace-sidebar-command-menu';
import {
	createWpcomSiteWorkspaces,
	getDefaultWpcomWorkspaceTarget,
	getSavedWpcomWorkspaceTarget,
	isSavedWpcomWorkspaceLocalTarget,
	mergeWpcomSitesWithConnectedSites,
	setSavedWpcomWorkspaceTarget,
	setSavedWpcomWorkspaceLocalTarget,
	type WpcomSiteWorkspace,
} from 'src/modules/wpcom-site-assistant/lib/workspaces';
import { useRootSelector } from 'src/stores';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { stagingSyncSelectors, syncOperationsSelectors } from 'src/stores/sync';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';
import type { SyncSite } from '@studio/common/types/sync';
import type { WpcomSiteActivity } from 'src/hooks/use-site-details';

interface SiteMenuProps {
	className?: string;
}

const SITE_MENU_TOOLTIP_PLACEMENT = 'right-start' as const;
const SIDEBAR_ROW_CLASSNAME =
	'flex flex-row min-w-[168px] h-8 hover:bg-[#ffffff0C] rounded transition-all ms-1 items-center';
const SIDEBAR_ROW_BUTTON_CLASSNAME =
	'p-2 text-xs rounded-tl rounded-bl whitespace-nowrap overflow-hidden text-ellipsis w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme';

function ButtonToRun( site: SiteDetails ) {
	const { running, id, name, enableXdebug } = site;
	const { startServer, stopServer, loadingServer } = useSiteDetails();
	const siteStartedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site started.' ),
		name
	);
	const siteStoppedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site stopped.' ),
		name
	);

	useEffect( () => {
		speak( running ? siteStartedMessage : siteStoppedMessage );
	}, [ running, siteStartedMessage, siteStoppedMessage ] );

	const classCircle = `rounded-full`;
	const triangle = (
		<svg
			aria-hidden="true"
			width="8"
			height="10"
			viewBox="0 0 8 10"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="rtl:scale-x-[-1]"
		>
			<path
				d="M0.25 0.854923C0.25 0.663717 0.455914 0.543288 0.622565 0.63703L7.17821 4.32458C7.33948 4.41529 7.34975 4.64367 7.19728 4.74849L0.641632 9.2555C0.475757 9.36953 0.25 9.25078 0.25 9.04949V0.854923Z"
				fill="#1ED15A"
				stroke="#00BA37"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const rectangle = (
		<svg
			aria-hidden="true"
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M0.25 2C0.25 1.0335 1.0335 0.25 2 0.25H8C8.9665 0.25 9.75 1.0335 9.75 2V8C9.75 8.9665 8.9665 9.75 8 9.75H2C1.0335 9.75 0.25 8.9665 0.25 8V2Z"
				fill="#FF8085"
				stroke="#F86368"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const tooltipText = loadingServer[ id ]
		? __( 'Starting' )
		: running
		? __( 'Stop site' )
		: __( 'Start site' );

	return (
		<Tooltip text={ tooltipText } placement={ SITE_MENU_TOOLTIP_PLACEMENT }>
			<button
				type="button"
				aria-disabled={ loadingServer[ id ] }
				onClick={ () => {
					if ( loadingServer[ id ] ) {
						return;
					}
					return running ? stopServer( id ) : startServer( site );
				} }
				className="w-7 h-8 rounded-tr rounded-br group grid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				aria-label={ sprintf( running ? __( 'stop %s site' ) : __( 'start %s site' ), name ) }
			>
				{ /* Circle or Xdebug icon */ }
				{ enableXdebug ? (
					<div
						className={ cx(
							'transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0',
							'row-start-1 col-start-1 place-self-center',
							loadingServer[ id ] && 'animate-pulse duration-100'
						) }
					>
						<XDebugIcon greyed={ ! running && ! loadingServer[ id ] } />
					</div>
				) : (
					<div
						className={ cx(
							'w-2.5 h-2.5 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 border-[0.5px]',
							'row-start-1 col-start-1 place-self-center',
							classCircle,
							loadingServer[ id ] &&
								'animate-pulse border-a8c-green-20/50 bg-a8c-green-20/50 duration-100',
							running && 'border-a8c-green-20 bg-a8c-green-20 duration-100',
							! running && ! loadingServer[ id ] && 'border-[#ffffff19] bg-[#ffffff26]'
						) }
					>
						&nbsp;
					</div>
				) }
				{ /* Shapes on hover */ }
				{ ! loadingServer[ id ] && (
					<div
						className={ cx(
							'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
							'row-start-1 col-start-1 place-self-center'
						) }
					>
						{ running ? rectangle : triangle }
					</div>
				) }
			</button>
		</Tooltip>
	);
}

function SiteItem( {
	site,
	index,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
	isDragOver,
	workspace,
	useWorkspaceCommandMenu,
	onOpenCommandMenu,
}: {
	site: SiteDetails;
	index: number;
	onDragStart: ( e: React.DragEvent, index: number ) => void;
	onDragOver: ( e: React.DragEvent, index: number ) => void;
	onDrop: ( e: React.DragEvent, index: number ) => void;
	onDragEnd: () => void;
	isDragOver: boolean;
	workspace?: WpcomSiteWorkspace;
	useWorkspaceCommandMenu: boolean;
	onOpenCommandMenu: ( context: WorkspaceSidebarCommandMenuContext ) => void;
} ) {
	const {
		sites,
		selectedSite,
		selectedWpcomSite,
		setSelectedSiteId,
		setSelectedWpcomSite,
		wpcomSiteActivity,
		loadingServer,
		isSiteDeleting,
	} = useSiteDetails();
	const isSelected =
		( ! selectedWpcomSite && site === selectedSite ) ||
		Boolean( workspace?.sites.some( ( wpcomSite ) => wpcomSite.id === selectedWpcomSite?.id ) );
	const { isSiteImporting, isSiteExporting } = useImportExport();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const isImporting = isSiteImporting( site.id );
	const isExporting = isSiteExporting( site.id );
	const isPulling = useRootSelector( syncOperationsSelectors.selectIsSiteIdPulling( site.id ) );
	const isPushing = useRootSelector( syncOperationsSelectors.selectIsSiteIdPushing( site.id ) );
	const environmentSyncState = useRootSelector(
		stagingSyncSelectors.selectRemoteSiteEnvironmentSyncState(
			workspace?.productionSite?.id ?? workspace?.stagingSites[ 0 ]?.id
		)
	);
	const isEnvironmentSyncing =
		environmentSyncState?.status === 'started' || environmentSyncState?.status === 'in-progress';
	const isSyncing = isPulling || isPushing;
	const isDeleting = isSiteDeleting( site.id );
	const showSpinner =
		site.isAddingSite ||
		isImporting ||
		( ! useWorkspaceCommandMenu && isSyncing ) ||
		isExporting ||
		isDeleting;

	let tooltipText: string;
	if ( site.isAddingSite ) {
		tooltipText = __( 'Adding' );
	} else if ( isImporting ) {
		tooltipText = __( 'Importing' );
	} else if ( isSyncing ) {
		tooltipText = __( 'Syncing' );
	} else {
		tooltipText = __( 'Loading' );
	}

	const handleContextMenu = ( e: React.MouseEvent ) => {
		e.preventDefault();
		if ( useWorkspaceCommandMenu ) {
			onOpenCommandMenu( { anchor: e.currentTarget, localSite: site, workspace } );
			return;
		}

		const ipcApi = getIpcApi();
		const isLoading = loadingServer[ site.id ] || false;
		const isAddingSite = site.isAddingSite || false;
		const isAnySiteAdding = sites.some( ( s ) => s.isAddingSite );
		const finderLabel = isWindows() ? __( 'File Explorer' ) : __( 'Finder' );
		const editorLabel =
			editor && supportedEditorConfig[ editor ] ? supportedEditorConfig[ editor ].label : null;
		const terminalLabel = getTerminalName( terminal );

		ipcApi.showSiteContextMenu( {
			siteId: site.id,
			isRunning: site.running,
			isLoading,
			isAddingSite,
			isAnySiteAdding,
			isSyncing,
			finderLabel,
			editorLabel,
			terminalLabel,
		} );
	};

	const handleCommandMenuKeyDown = ( e: React.KeyboardEvent< HTMLButtonElement > ) => {
		if ( ! useWorkspaceCommandMenu ) {
			return;
		}

		if ( e.key !== 'ContextMenu' && ! ( e.shiftKey && e.key === 'F10' ) ) {
			return;
		}

		e.preventDefault();
		onOpenCommandMenu( { anchor: e.currentTarget, localSite: site, workspace } );
	};

	const handleSelectLocalTarget = () => {
		if ( workspace ) {
			setSavedWpcomWorkspaceLocalTarget( workspace.id );
		}
		setSelectedSiteId( site.id );
	};

	const handleSelectWpcomTarget = ( wpcomSite: SyncSite ) => {
		if ( workspace ) {
			setSavedWpcomWorkspaceTarget( workspace.id, wpcomSite.id );
		}
		setSelectedWpcomSite( wpcomSite );
	};

	return (
		<li
			className={ cx(
				SIDEBAR_ROW_CLASSNAME,
				isMac() ? 'me-5' : 'me-4',
				isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]',
				isDragOver && 'bg-[#ffffff26]'
			) }
			onContextMenu={ handleContextMenu }
			draggable
			onDragStart={ ( e ) => onDragStart( e, index ) }
			onDragOver={ ( e ) => onDragOver( e, index ) }
			onDrop={ ( e ) => onDrop( e, index ) }
			onDragEnd={ onDragEnd }
		>
			<button
				type="button"
				className={ SIDEBAR_ROW_BUTTON_CLASSNAME }
				onKeyDown={ handleCommandMenuKeyDown }
				onClick={ () => {
					const savedWorkspaceTarget = workspace
						? getSavedWpcomWorkspaceTarget( workspace )
						: undefined;
					if (
						workspace &&
						savedWorkspaceTarget &&
						! isSavedWpcomWorkspaceLocalTarget( workspace )
					) {
						setSelectedWpcomSite( savedWorkspaceTarget );
						return;
					}

					if ( workspace ) {
						setSavedWpcomWorkspaceLocalTarget( workspace.id );
					}
					setSelectedSiteId( site.id );
				} }
			>
				{ site.name }
			</button>
			{ showSpinner ? (
				<Tooltip text={ tooltipText } placement={ SITE_MENU_TOOLTIP_PLACEMENT }>
					<div className="me-2 grid h-8 w-7 shrink-0 place-items-center">
						<Spinner className="!m-0 !w-2.5 !h-2.5 [&>circle]:stroke-a8c-gray-70" />
					</div>
				</Tooltip>
			) : useWorkspaceCommandMenu ? (
				<WorkspaceTargetControls
					localSite={ site }
					workspace={ workspace }
					selectedSite={ selectedSite }
					selectedWpcomSite={ selectedWpcomSite }
					wpcomSiteActivity={ wpcomSiteActivity }
					isEnvironmentSyncing={ isEnvironmentSyncing }
					isLocalSyncing={ isSyncing }
					onSelectLocal={ handleSelectLocalTarget }
					onSelectWpcomSite={ handleSelectWpcomTarget }
				/>
			) : (
				<ButtonToRun { ...site } />
			) }
		</li>
	);
}

function WorkspaceTargetControls( {
	localSite,
	workspace,
	selectedSite,
	selectedWpcomSite,
	wpcomSiteActivity,
	isEnvironmentSyncing = false,
	isLocalSyncing = false,
	remoteSiteForLocalTarget,
	onSelectLocal,
	onSelectWpcomSite,
}: {
	localSite?: SiteDetails;
	workspace?: WpcomSiteWorkspace;
	selectedSite?: SiteDetails | null;
	selectedWpcomSite?: SyncSite | null;
	wpcomSiteActivity?: Record< number, WpcomSiteActivity >;
	isEnvironmentSyncing?: boolean;
	isLocalSyncing?: boolean;
	remoteSiteForLocalTarget?: SyncSite;
	onSelectLocal?: () => void;
	onSelectWpcomSite?: ( site: SyncSite ) => void;
} ) {
	type WorkspaceTargetStatus = {
		variant: 'spinner' | 'unread';
		label: string;
	};

	type WorkspaceTargetBadge = {
		key: 'production' | 'staging' | 'local';
		label: string;
		ariaLabel: string;
		isActive: boolean;
		buttonClassName: string;
		dotClassName: string;
		statusClassName: string;
		status?: WorkspaceTargetStatus;
		tooltip?: string;
		disabled?: boolean;
		onSelect?: () => void;
	};
	const productionSite = workspace?.productionSite;
	const stagingSite = workspace?.stagingSites[ 0 ];
	const isCreatingStagingSite = Boolean(
		productionSite && wpcomSiteActivity?.[ productionSite.id ]?.isCreatingStagingSite
	);
	const isCreatingLocalSite = Boolean(
		remoteSiteForLocalTarget &&
			wpcomSiteActivity?.[ remoteSiteForLocalTarget.id ]?.isCreatingLocalSite
	);
	const localActionUrl = remoteSiteForLocalTarget
		? getSyncSupportActionUrl( remoteSiteForLocalTarget )
		: undefined;
	const isSelectedWorkspace =
		( localSite && ! selectedWpcomSite && selectedSite?.id === localSite.id ) ||
		Boolean( workspace?.sites.some( ( wpcomSite ) => wpcomSite.id === selectedWpcomSite?.id ) );
	const badges: WorkspaceTargetBadge[] = [];

	if ( productionSite ) {
		badges.push( {
			key: 'production',
			label: __( 'Production' ) as string,
			ariaLabel: sprintf(
				// translators: %s is the production site URL.
				__( 'Select Production target: %s' ),
				productionSite.url
			),
			isActive: isSelectedWorkspace && selectedWpcomSite?.id === productionSite.id,
			buttonClassName: 'border-circle-env-production',
			dotClassName: 'bg-circle-env-production',
			statusClassName: 'text-circle-env-production',
			status: getTargetActivityStatus(
				wpcomSiteActivity?.[ productionSite.id ],
				isEnvironmentSyncing && Boolean( stagingSite )
			),
			onSelect: () => onSelectWpcomSite?.( productionSite ),
		} );
	}

	if ( stagingSite ) {
		badges.push( {
			key: 'staging',
			label: __( 'Staging' ) as string,
			ariaLabel: sprintf(
				// translators: %s is the staging site URL.
				__( 'Select Staging target: %s' ),
				stagingSite.url
			),
			isActive: isSelectedWorkspace && selectedWpcomSite?.id === stagingSite.id,
			buttonClassName: 'border-circle-env-staging',
			dotClassName: 'bg-circle-env-staging',
			statusClassName: 'text-circle-env-staging',
			status: getTargetActivityStatus(
				wpcomSiteActivity?.[ stagingSite.id ],
				isCreatingStagingSite || isEnvironmentSyncing
			),
			onSelect: () => onSelectWpcomSite?.( stagingSite ),
		} );
	} else if ( productionSite && isCreatingStagingSite ) {
		badges.push( {
			key: 'staging',
			label: __( 'Staging' ) as string,
			ariaLabel: __( 'Creating staging target' ),
			isActive: false,
			buttonClassName: 'border-circle-env-staging',
			dotClassName: 'bg-circle-env-staging',
			statusClassName: 'text-circle-env-staging',
			status: {
				variant: 'spinner',
				label: __( 'Creating staging site' ),
			},
			disabled: true,
		} );
	}

	if ( localSite ) {
		badges.push( {
			key: 'local',
			label: ( localSite.running ? __( 'Local running' ) : __( 'Local stopped' ) ) as string,
			ariaLabel: localSite.running
				? sprintf(
						// translators: %s is the local site name.
						__( 'Select Local target: %s is running' ),
						localSite.name
				  )
				: sprintf(
						// translators: %s is the local site name.
						__( 'Select Local target: %s is stopped' ),
						localSite.name
				  ),
			isActive: isSelectedWorkspace && ! selectedWpcomSite && selectedSite?.id === localSite.id,
			buttonClassName: localSite.running ? 'border-a8c-green-20' : 'border-[#ffffff33]',
			dotClassName: localSite.running ? 'bg-a8c-green-20' : 'bg-a8c-gray-500',
			statusClassName: localSite.running ? 'text-a8c-green-20' : 'text-a8c-gray-500',
			status: getTargetActivityStatus( undefined, isLocalSyncing ),
			onSelect: onSelectLocal,
		} );
	} else if ( remoteSiteForLocalTarget ) {
		const isActionable =
			Boolean( localActionUrl ) || canCreateLocalSiteFromRemote( remoteSiteForLocalTarget );
		badges.push( {
			key: 'local',
			label: __( 'Local' ) as string,
			ariaLabel: isActionable
				? sprintf(
						// translators: %s is a WordPress.com site URL.
						__( 'Create or prepare Local target from: %s' ),
						remoteSiteForLocalTarget.url
				  )
				: getSyncSupportTitle( remoteSiteForLocalTarget ),
			isActive: false,
			buttonClassName: 'border-[#ffffff33] border-dashed',
			dotClassName: 'bg-a8c-gray-500',
			statusClassName: 'text-a8c-gray-500',
			status: isCreatingLocalSite
				? {
						variant: 'spinner',
						label: __( 'Creating local site' ),
				  }
				: undefined,
			tooltip: `${ getSyncSupportTitle( remoteSiteForLocalTarget ) }. ${ getSyncSupportDescription(
				remoteSiteForLocalTarget
			) }`,
			disabled: ! isActionable || isCreatingLocalSite,
			onSelect: onSelectLocal,
		} );
	}

	if ( badges.length === 0 ) {
		return null;
	}

	const label = sprintf(
		// translators: %s is a comma-separated list of workspace targets, such as "Production, Staging, Local".
		__( 'Workspace targets: %s' ),
		badges.map( ( badge ) => badge.label ).join( ', ' )
	);

	return (
		<div role="group" aria-label={ label } className="me-2 flex h-8 shrink-0 items-center gap-1">
			{ badges.map( ( badge ) => (
				<Tooltip
					key={ badge.key }
					text={ badge.status?.label ?? badge.tooltip ?? badge.label }
					placement={ SITE_MENU_TOOLTIP_PLACEMENT }
				>
					<button
						type="button"
						aria-label={ badge.ariaLabel }
						aria-disabled={ badge.disabled }
						onClick={ ( event ) => {
							event.stopPropagation();
							if ( badge.disabled ) {
								return;
							}
							badge.onSelect?.();
						} }
						className={ cx(
							'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme',
							badge.buttonClassName,
							badge.isActive ? 'bg-white/10 opacity-100' : 'bg-transparent opacity-75'
						) }
					>
						{ badge.status?.variant === 'spinner' ? (
							<span
								role="status"
								aria-label={ badge.status.label }
								className={ cx( 'grid h-3 w-3 place-items-center', badge.statusClassName ) }
							>
								<Spinner className="!m-0 !h-3 !w-3 [&>circle]:stroke-current" />
							</span>
						) : badge.status?.variant === 'unread' ? (
							<span
								role="status"
								aria-label={ badge.status.label }
								className="h-2 w-2 rounded-full bg-frame-theme"
							/>
						) : (
							<span
								aria-hidden="true"
								className={ cx(
									'rounded-full',
									badge.isActive ? 'h-2 w-2' : 'h-1.5 w-1.5',
									badge.dotClassName
								) }
							/>
						) }
					</button>
				</Tooltip>
			) ) }
		</div>
	);
}

const getTargetActivityStatus = ( activity?: WpcomSiteActivity, isEnvironmentSyncing = false ) => {
	if ( activity?.isCreatingStagingSite ) {
		return {
			variant: 'spinner' as const,
			label: __( 'Creating staging site' ),
		};
	}

	if ( isEnvironmentSyncing ) {
		return {
			variant: 'spinner' as const,
			label: __( 'Syncing' ),
		};
	}

	if ( activity?.isAssistantThinking ) {
		return {
			variant: 'spinner' as const,
			label: __( 'Dolly is thinking' ),
		};
	}

	if (
		activity?.hasUnreadAssistantMessage &&
		! activity.isCreatingStagingSite &&
		! activity.isAssistantThinking
	) {
		return {
			variant: 'unread' as const,
			label: __( 'Unread Dolly response' ),
		};
	}

	return undefined;
};

function WpcomSiteItem( {
	workspace,
	onOpenCommandMenu,
}: {
	workspace: WpcomSiteWorkspace;
	onOpenCommandMenu: ( context: WorkspaceSidebarCommandMenuContext ) => void;
} ) {
	const { selectedWpcomSite, setSelectedWpcomSite, setSelectedSiteId, wpcomSiteActivity } =
		useSiteDetails();
	const { confirmCreateLocalSiteFromRemote } = useCreateLocalSiteFromRemote();
	const selectedWorkspaceSite = workspace.sites.find(
		( site ) => site.id === selectedWpcomSite?.id
	);
	const isSelected = Boolean( selectedWorkspaceSite );
	const siteToOpen = selectedWorkspaceSite ?? getDefaultWpcomWorkspaceTarget( workspace );
	const remoteSiteForLocalTarget = selectedWorkspaceSite ?? siteToOpen;
	const localActionUrl = getSyncSupportActionUrl( remoteSiteForLocalTarget );
	const environmentSyncState = useRootSelector(
		stagingSyncSelectors.selectRemoteSiteEnvironmentSyncState(
			workspace.productionSite?.id ?? workspace.stagingSites[ 0 ]?.id
		)
	);
	const isEnvironmentSyncing =
		environmentSyncState?.status === 'started' || environmentSyncState?.status === 'in-progress';
	const handleContextMenu = ( e: React.MouseEvent ) => {
		e.preventDefault();
		onOpenCommandMenu( { anchor: e.currentTarget, workspace } );
	};
	const handleCommandMenuKeyDown = ( e: React.KeyboardEvent< HTMLButtonElement > ) => {
		if ( e.key !== 'ContextMenu' && ! ( e.shiftKey && e.key === 'F10' ) ) {
			return;
		}

		e.preventDefault();
		onOpenCommandMenu( { anchor: e.currentTarget, workspace } );
	};
	const handleSelectWpcomTarget = ( wpcomSite: SyncSite ) => {
		setSavedWpcomWorkspaceTarget( workspace.id, wpcomSite.id );
		setSelectedWpcomSite( wpcomSite );
	};
	const handleSelectLocalTarget = async () => {
		if ( workspace.localSite ) {
			setSavedWpcomWorkspaceLocalTarget( workspace.id );
			setSelectedSiteId( workspace.localSite.id );
			return;
		}

		if ( localActionUrl ) {
			getIpcApi().openURL( localActionUrl );
			return;
		}

		if ( ! canCreateLocalSiteFromRemote( remoteSiteForLocalTarget ) ) {
			return;
		}

		const createdLocalSite = await confirmCreateLocalSiteFromRemote( remoteSiteForLocalTarget );
		if ( ! createdLocalSite ) {
			return;
		}

		setSavedWpcomWorkspaceLocalTarget( workspace.id );
		setSelectedSiteId( createdLocalSite.id );
	};

	return (
		<li
			className={ cx(
				SIDEBAR_ROW_CLASSNAME,
				isMac() ? 'me-5' : 'me-4',
				isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
			) }
			onContextMenu={ handleContextMenu }
		>
			<button
				type="button"
				className={ SIDEBAR_ROW_BUTTON_CLASSNAME }
				onKeyDown={ handleCommandMenuKeyDown }
				onClick={ () => {
					setSavedWpcomWorkspaceTarget( workspace.id, siteToOpen.id );
					setSelectedWpcomSite( siteToOpen );
				} }
			>
				{ workspace.name }
			</button>
			{ workspace.sites.length > 0 ? (
				<WorkspaceTargetControls
					workspace={ workspace }
					selectedWpcomSite={ selectedWpcomSite }
					wpcomSiteActivity={ wpcomSiteActivity }
					isEnvironmentSyncing={ isEnvironmentSyncing }
					remoteSiteForLocalTarget={ remoteSiteForLocalTarget }
					onSelectLocal={ () => void handleSelectLocalTarget() }
					onSelectWpcomSite={ handleSelectWpcomTarget }
				/>
			) : null }
		</li>
	);
}

export default function SiteMenu( { className }: SiteMenuProps ) {
	const {
		sites,
		selectedSite,
		setSelectedSiteId,
		startServer,
		stopServer,
		setIsEditModalOpen,
		copySite,
		updateSitesSortOrder,
		setWpcomSites = () => undefined,
	} = useSiteDetails();
	const { isAuthenticated, user } = useAuth();
	const { enableWorkspaces } = useFeatureFlags();
	const { setSelectedTab } = useContentTabs();
	const { handleDeleteSite } = useDeleteSite();
	const { data: editor } = useGetUserEditorQuery();
	const [ draggedIndex, setDraggedIndex ] = useState< number | null >( null );
	const [ dragOverIndex, setDragOverIndex ] = useState< number | null >( null );
	const [ connectedWpcomSites, setConnectedWpcomSites ] = useState< SyncSite[] >( [] );
	const [ commandMenuContext, setCommandMenuContext ] =
		useState< WorkspaceSidebarCommandMenuContext | null >( null );
	const [ syncPanelWorkspace, setSyncPanelWorkspace ] = useState< WpcomSiteWorkspace | null >(
		null
	);
	const connectedWpcomSiteIds = useMemo(
		() => connectedWpcomSites.map( ( site ) => site.id ),
		[ connectedWpcomSites ]
	);
	const { data: wpcomSitesData, isFetching: isFetchingWpcomSites } = useGetWpComSitesQuery(
		{
			connectedSiteIds: connectedWpcomSiteIds,
			userId: user?.id,
			perPage: 100,
		},
		{ skip: ! isAuthenticated || ! enableWorkspaces }
	);
	const wpcomSites = useMemo(
		() =>
			enableWorkspaces
				? mergeWpcomSitesWithConnectedSites( wpcomSitesData?.sites ?? [], connectedWpcomSites )
				: [],
		[ connectedWpcomSites, enableWorkspaces, wpcomSitesData?.sites ]
	);
	const wpcomSiteWorkspaces = useMemo(
		() => ( enableWorkspaces ? createWpcomSiteWorkspaces( wpcomSites, sites ) : [] ),
		[ enableWorkspaces, sites, wpcomSites ]
	);
	const wpcomOnlySiteWorkspaces = useMemo(
		() => wpcomSiteWorkspaces.filter( ( workspace ) => ! workspace.localSite ),
		[ wpcomSiteWorkspaces ]
	);
	const wpcomSiteWorkspaceByLocalSiteId = useMemo(
		() =>
			new Map(
				wpcomSiteWorkspaces
					.filter( ( workspace ) => workspace.localSite )
					.map( ( workspace ) => [ workspace.localSite!.id, workspace ] )
			),
		[ wpcomSiteWorkspaces ]
	);

	useEffect( () => {
		setWpcomSites( wpcomSites );
	}, [ setWpcomSites, wpcomSites ] );

	useEffect( () => {
		if ( ! enableWorkspaces || ! isAuthenticated ) {
			setConnectedWpcomSites( [] );
			return;
		}

		let isCurrent = true;
		const refreshConnectedWpcomSites = () => {
			getIpcApi()
				.getConnectedWpcomSites()
				.then( ( connectedSites ) => {
					if ( isCurrent ) {
						setConnectedWpcomSites( connectedSites );
					}
				} )
				.catch( ( error ) => {
					console.error( 'Failed to load connected WordPress.com sites:', error );
				} );
		};

		refreshConnectedWpcomSites();
		window.addEventListener( CONNECTED_WPCOM_SITES_UPDATED_EVENT, refreshConnectedWpcomSites );

		return () => {
			isCurrent = false;
			window.removeEventListener( CONNECTED_WPCOM_SITES_UPDATED_EVENT, refreshConnectedWpcomSites );
		};
	}, [ enableWorkspaces, isAuthenticated ] );

	const handleDragStart = ( e: React.DragEvent, index: number ) => {
		setDraggedIndex( index );
		e.dataTransfer.effectAllowed = 'move';
	};

	const handleDragOver = ( e: React.DragEvent, index: number ) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		if ( draggedIndex !== null && draggedIndex !== index ) {
			setDragOverIndex( index );
		}
	};

	const handleDrop = ( e: React.DragEvent, targetIndex: number ) => {
		e.preventDefault();
		setDragOverIndex( null );
		if ( draggedIndex === null || draggedIndex === targetIndex ) {
			return;
		}

		const updatedSites = [ ...sites ];
		const [ movedSite ] = updatedSites.splice( draggedIndex, 1 );
		updatedSites.splice( targetIndex, 0, movedSite );

		updateSitesSortOrder( updatedSites ).catch( ( error ) => {
			console.error( 'Failed to save site order:', error );
		} );
	};

	const handleDragEnd = () => {
		setDraggedIndex( null );
		setDragOverIndex( null );
	};

	useEffect( () => {
		const unsubscribe = window.ipcListener.subscribe(
			'site-context-menu-action',
			async ( _, actionData: { action: string; siteId: string } ) => {
				const site = sites.find( ( site ) => site.id === actionData.siteId );
				if ( ! site ) {
					return;
				}

				const ipcApi = getIpcApi();
				switch ( actionData.action ) {
					case 'start':
						void startServer( site );
						break;
					case 'stop':
						void stopServer( site.id );
						break;
					case 'open-site':
						if ( ! site.running ) {
							await startServer( site );
						}
						ipcApi.openSiteURL( site.id, '', { autoLogin: false } );
						break;
					case 'open-admin':
						if ( ! site.running ) {
							await startServer( site );
						}
						ipcApi.openSiteURL( site.id, '/wp-admin/' );
						break;
					case 'open-finder':
						ipcApi.openLocalPath( site.path );
						break;
					case 'open-editor':
						if ( editor ) {
							void ipcApi.openAppAtPath( editor, site.path );
						}
						break;
					case 'open-terminal':
						void ( async () => {
							try {
								await ipcApi.openTerminalAtPath( site.path );
							} catch ( error ) {
								Sentry.captureException( error );
								alert( __( 'Could not open the terminal.' ) );
							}
						} )();
						break;
					case 'edit-site':
						if ( site.id !== selectedSite?.id ) {
							setSelectedSiteId( site.id );
						}
						setSelectedTab( 'settings' );
						setIsEditModalOpen( true );
						break;
					case 'copy-site':
						void ( async () => {
							try {
								await copySite( site.id );
							} catch ( error ) {
								Sentry.captureException( error );
							}
						} )();
						break;
					case 'delete':
						await handleDeleteSite( site.id, site.name );
						break;
				}
			}
		);

		return () => {
			unsubscribe?.();
		};
	}, [
		sites,
		editor,
		selectedSite?.id,
		setSelectedTab,
		setIsEditModalOpen,
		setSelectedSiteId,
		startServer,
		stopServer,
		copySite,
		handleDeleteSite,
	] );

	return (
		<>
			<nav
				aria-label={ __( 'Sites' ) }
				style={ {
					scrollbarGutter: 'stable',
				} }
				className={ cx(
					'w-full overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pb-4',
					className
				) }
			>
				<ul className="pt-px">
					{ sites.map( ( site, index ) => (
						<SiteItem
							key={ site.id }
							site={ site }
							index={ index }
							onDragStart={ handleDragStart }
							onDragOver={ handleDragOver }
							onDrop={ handleDrop }
							onDragEnd={ handleDragEnd }
							isDragOver={ dragOverIndex === index }
							workspace={
								enableWorkspaces ? wpcomSiteWorkspaceByLocalSiteId.get( site.id ) : undefined
							}
							useWorkspaceCommandMenu={ enableWorkspaces }
							onOpenCommandMenu={ setCommandMenuContext }
						/>
					) ) }
					{ enableWorkspaces &&
						isAuthenticated &&
						wpcomOnlySiteWorkspaces.map( ( workspace ) => (
							<WpcomSiteItem
								key={ workspace.id }
								workspace={ workspace }
								onOpenCommandMenu={ setCommandMenuContext }
							/>
						) ) }
					{ enableWorkspaces && isAuthenticated && isFetchingWpcomSites && (
						<li
							className={ cx(
								'flex h-8 min-w-[168px] items-center px-2 text-xs text-a8c-gray-600',
								isMac() ? 'me-5 ms-1' : 'me-4 ms-1'
							) }
						>
							{ __( 'Loading...' ) }
						</li>
					) }
					{ /* Drop zone for dragging to bottom of list */ }
					<li
						className="h-8"
						onDragOver={ ( e ) => handleDragOver( e, sites.length ) }
						onDrop={ ( e ) => handleDrop( e, sites.length ) }
					/>
				</ul>
			</nav>
			{ enableWorkspaces && (
				<WorkspaceSidebarCommandMenu
					context={ commandMenuContext }
					onClose={ () => setCommandMenuContext( null ) }
					onOpenSync={ ( workspace ) => {
						setCommandMenuContext( null );
						setSyncPanelWorkspace( workspace );
					} }
				/>
			) }
			{ syncPanelWorkspace && (
				<WorkspaceSyncPanel
					workspace={ syncPanelWorkspace }
					onClose={ () => setSyncPanelWorkspace( null ) }
				/>
			) }
		</>
	);
}
