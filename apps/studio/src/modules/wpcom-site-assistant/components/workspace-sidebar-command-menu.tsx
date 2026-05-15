import * as Sentry from '@sentry/electron/renderer';
import { Popover, Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { check, external, Icon, plus, trash, wordpress } from '@wordpress/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from 'src/components/button';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import {
	getWpcomSiteAssistantConversationLabel,
	getWpcomSiteAssistantConversationMenuLabel,
	getWpcomSiteAssistantConversationUpdatedLabel,
	shouldShowWpcomSiteAssistantConversationControls,
} from 'src/modules/wpcom-site-assistant/lib/conversations';
import {
	createNewWpcomSiteAssistantConversation,
	deleteWpcomSiteAssistantConversation,
	getWpcomSiteAssistantConversationsForSite,
	notifyWpcomSiteAssistantSessionStateUpdated,
	setSelectedWpcomSiteAssistantConversationId,
	wpcomSiteAssistantSelectedConversationIdsBySiteId,
} from 'src/modules/wpcom-site-assistant/lib/session';
import {
	getKnownStagingCreationBlocker,
	getStagingCreationErrorMessage,
	getStagingPlanUpgradeUrl,
	isStagingPlanUpgradeRequired,
} from 'src/modules/wpcom-site-assistant/lib/staging';
import { getWpcomSiteAssistantTurn } from 'src/modules/wpcom-site-assistant/lib/turns';
import {
	getDefaultWpcomWorkspaceTarget,
	getSavedWpcomWorkspaceTarget,
	isSavedWpcomWorkspaceLocalTarget,
	setSavedWpcomWorkspaceLocalTarget,
	setSavedWpcomWorkspaceTarget,
	type WpcomSiteWorkspace,
} from 'src/modules/wpcom-site-assistant/lib/workspaces';
import { useRootSelector } from 'src/stores';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { syncOperationsSelectors } from 'src/stores/sync';
import { useCreateWpcomStagingSiteMutation } from 'src/stores/sync/wpcom-sites';
import type { SyncSite } from '@studio/common/types/sync';

export type WorkspaceSidebarCommandMenuContext = {
	anchor: Element;
	localSite?: SiteDetails;
	workspace?: WpcomSiteWorkspace;
};

type WorkspaceSidebarCommandMenuProps = {
	context: WorkspaceSidebarCommandMenuContext | null;
	onClose: () => void;
	onOpenSync: ( workspace: WpcomSiteWorkspace ) => void;
};

type WorkspaceSidebarCommand = {
	id: string;
	label: string;
	secondary?: string;
	icon?: JSX.Element;
	active?: boolean;
	disabled?: boolean;
	disabledReason?: string;
	destructive?: boolean;
	isLoading?: boolean;
	onSelect?: () => void | Promise< void >;
};

type WorkspaceSidebarCommandGroup = {
	id: string;
	label?: string;
	commands: WorkspaceSidebarCommand[];
};

const resolveRemoteSiteUrl = ( site: SyncSite, path = '/' ) => {
	try {
		return new URL( path, site.url.endsWith( '/' ) ? site.url : `${ site.url }/` ).toString();
	} catch {
		return site.url;
	}
};

const getSavedOrDefaultRemoteTarget = ( workspace?: WpcomSiteWorkspace ) => {
	if ( ! workspace ) {
		return undefined;
	}

	return getSavedWpcomWorkspaceTarget( workspace ) ?? getDefaultWpcomWorkspaceTarget( workspace );
};

const getWorkspaceChatTarget = ( workspace?: WpcomSiteWorkspace ) => {
	const savedTarget = getSavedOrDefaultRemoteTarget( workspace );
	if ( savedTarget ) {
		return savedTarget;
	}

	return workspace?.productionSite ?? workspace?.stagingSites[ 0 ];
};

function CommandRow( {
	command,
	closeOnSelect = true,
	onClose,
}: {
	command: WorkspaceSidebarCommand;
	closeOnSelect?: boolean;
	onClose: () => void;
} ) {
	const handleClick = async () => {
		if ( command.disabled ) {
			return;
		}

		await command.onSelect?.();
		if ( closeOnSelect ) {
			onClose();
		}
	};

	return (
		<button
			type="button"
			role="menuitem"
			disabled={ command.disabled }
			aria-disabled={ command.disabled }
			className={ cx(
				'grid w-full grid-cols-[1.25rem_minmax(0,1fr)_1rem] items-center gap-2 rounded px-2 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme',
				command.disabled
					? 'cursor-not-allowed text-frame-text-secondary opacity-60'
					: 'text-frame-text hover:bg-frame-surface',
				command.destructive && ! command.disabled && 'text-a8c-red-50 hover:text-a8c-red-70'
			) }
			onClick={ handleClick }
		>
			<span className="grid h-5 w-5 place-items-center">
				{ command.isLoading ? <Spinner className="!m-0 !h-3 !w-3" /> : command.icon ?? null }
			</span>
			<span className="min-w-0">
				<span className="block truncate font-medium">{ command.label }</span>
				{ ( command.secondary || command.disabledReason ) && (
					<span className="block truncate text-xs text-frame-text-secondary">
						{ command.disabledReason ?? command.secondary }
					</span>
				) }
			</span>
			<span className="grid h-4 w-4 place-items-center">
				{ command.active && ! command.icon && <Icon icon={ check } size={ 16 } /> }
			</span>
		</button>
	);
}

function CommandGroup( {
	group,
	onClose,
}: {
	group: WorkspaceSidebarCommandGroup;
	onClose: () => void;
} ) {
	if ( group.commands.length === 0 ) {
		return null;
	}

	return (
		<div className="border-t border-a8c-gray-5 first:border-t-0 py-1">
			{ group.label && (
				<div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-frame-text-secondary">
					{ group.label }
				</div>
			) }
			{ group.commands.map( ( command ) => (
				<CommandRow key={ command.id } command={ command } onClose={ onClose } />
			) ) }
		</div>
	);
}

export function WorkspaceSidebarCommandMenu( {
	context,
	onClose,
	onOpenSync,
}: WorkspaceSidebarCommandMenuProps ) {
	const {
		sites,
		selectedSite,
		selectedWpcomSite,
		setSelectedSiteId,
		setSelectedWpcomSite,
		startServer,
		stopServer,
		loadingServer,
		setIsEditModalOpen,
		copySite,
		wpcomSiteActivity,
		setWpcomSiteActivity,
	} = useSiteDetails();
	const { setSelectedTab } = useContentTabs();
	const { handleDeleteSite } = useDeleteSite();
	const { isAuthenticated, client, user } = useAuth();
	const isOffline = useOffline();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const [ createWpcomStagingSite, createWpcomStagingSiteResult ] =
		useCreateWpcomStagingSiteMutation();
	const [ creatingStagingSiteId, setCreatingStagingSiteId ] = useState< number | undefined >();
	const [ chatListVersion, setChatListVersion ] = useState( 0 );
	const menuRef = useRef< HTMLDivElement >( null );
	const rowLocalSite = context?.localSite;
	const workspace = context?.workspace;
	const workspaceLocalSite = workspace?.localSite ?? rowLocalSite;
	const userId = user?.id;
	const productionSite = workspace?.productionSite;
	const stagingSite = workspace?.stagingSites[ 0 ];
	const isLocalTargetSaved = workspace ? isSavedWpcomWorkspaceLocalTarget( workspace ) : false;
	const savedRemoteTarget = workspace ? getSavedWpcomWorkspaceTarget( workspace ) : undefined;
	const selectedRemoteTarget = workspace?.sites.find(
		( site ) => site.id === selectedWpcomSite?.id
	);
	const isSelectedLocalTarget = Boolean(
		workspaceLocalSite && ! selectedWpcomSite && selectedSite?.id === workspaceLocalSite.id
	);
	const isActiveLocalTarget = Boolean(
		workspaceLocalSite &&
			( ! workspace ||
				isLocalTargetSaved ||
				isSelectedLocalTarget ||
				( rowLocalSite && ! selectedRemoteTarget && ! savedRemoteTarget ) )
	);
	const localSite = isActiveLocalTarget ? workspaceLocalSite : undefined;
	const activeRemoteTarget = isActiveLocalTarget
		? undefined
		: selectedRemoteTarget ?? savedRemoteTarget ?? getWorkspaceChatTarget( workspace );
	const chatTarget = activeRemoteTarget;
	const conversationsForChatTarget = useMemo( () => {
		void chatListVersion;
		return chatTarget ? getWpcomSiteAssistantConversationsForSite( chatTarget.id ) : [];
	}, [ chatListVersion, chatTarget ] );
	const selectedConversationIdForChatTarget = chatTarget
		? wpcomSiteAssistantSelectedConversationIdsBySiteId.get( chatTarget.id )
		: undefined;
	const selectedConversationForChatTarget =
		conversationsForChatTarget.find(
			( conversation ) => conversation.id === selectedConversationIdForChatTarget
		) ?? conversationsForChatTarget[ 0 ];
	const showChatCommands =
		chatTarget &&
		shouldShowWpcomSiteAssistantConversationControls(
			conversationsForChatTarget,
			selectedConversationForChatTarget
		);
	const isAnySiteAdding = sites.some( ( site ) => site.isAddingSite );
	const isLocalSiteLoading = localSite ? Boolean( loadingServer[ localSite.id ] ) : false;
	const isLocalSiteAdding = Boolean( localSite?.isAddingSite );
	const isLocalSitePulling = useRootSelector(
		syncOperationsSelectors.selectIsSiteIdPulling( localSite?.id ?? '' )
	);
	const isLocalSitePushing = useRootSelector(
		syncOperationsSelectors.selectIsSiteIdPushing( localSite?.id ?? '' )
	);
	const isLocalSiteSyncing = isLocalSitePulling || isLocalSitePushing;
	const canUseLocalSiteCommands = Boolean( localSite && ! isLocalSiteAdding );
	const isStagingCreateInFlight =
		Boolean( productionSite && wpcomSiteActivity[ productionSite.id ]?.isCreatingStagingSite ) ||
		( createWpcomStagingSiteResult.isLoading && creatingStagingSiteId === productionSite?.id );
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
		: isStagingCreateInFlight
		? __( 'Creating staging site...' )
		: isOffline
		? __( 'Connect to the internet to create a staging site.' )
		: ! isAuthenticated || ! client
		? __( 'Log in to WordPress.com to create a staging site.' )
		: hasMissingStagingSiteDetails
		? __( 'Staging exists, but Studio could not load its details. Refresh WordPress.com sites.' )
		: stagingCreationBlocker;
	const isStagingUpgradeAvailable = Boolean(
		productionSite && ! stagingSite && isStagingPlanUpgradeRequired( productionSite )
	);

	useEffect( () => {
		if ( ! context?.anchor ) {
			return;
		}

		const handlePointerDown = ( event: PointerEvent ) => {
			const target = event.target;
			if ( ! ( target instanceof Node ) ) {
				return;
			}

			if ( context.anchor.contains( target ) || menuRef.current?.contains( target ) ) {
				return;
			}

			onClose();
		};

		document.addEventListener( 'pointerdown', handlePointerDown, true );
		return () => document.removeEventListener( 'pointerdown', handlePointerDown, true );
	}, [ context?.anchor, onClose ] );

	const selectRemoteTarget = useCallback(
		( site: SyncSite ) => {
			if ( workspace ) {
				setSavedWpcomWorkspaceTarget( workspace.id, site.id );
			}
			setSelectedWpcomSite( site );
		},
		[ setSelectedWpcomSite, workspace ]
	);

	const selectLocalTarget = useCallback( () => {
		if ( ! workspace?.localSite ) {
			return;
		}

		setSavedWpcomWorkspaceLocalTarget( workspace.id );
		setSelectedSiteId( workspace.localSite.id );
	}, [ setSelectedSiteId, workspace ] );

	const createStagingSite = useCallback( async () => {
		if ( ! productionSite || ! canCreateStagingSite ) {
			return;
		}

		setCreatingStagingSiteId( productionSite.id );
		setWpcomSiteActivity( productionSite.id, { isCreatingStagingSite: true } );

		try {
			const createdStagingSite = await createWpcomStagingSite( {
				site: productionSite,
				userId,
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
		} finally {
			setWpcomSiteActivity( productionSite.id, { isCreatingStagingSite: false } );
			setCreatingStagingSiteId( undefined );
		}
	}, [
		canCreateStagingSite,
		createWpcomStagingSite,
		productionSite,
		setSelectedWpcomSite,
		setWpcomSiteActivity,
		userId,
		workspace,
	] );

	const selectChatTarget = useCallback(
		( site: SyncSite ) => {
			if ( workspace ) {
				setSavedWpcomWorkspaceTarget( workspace.id, site.id );
			}
			setSelectedWpcomSite( site );
		},
		[ setSelectedWpcomSite, workspace ]
	);

	const selectConversation = useCallback(
		( conversationId: string ) => {
			if ( ! chatTarget ) {
				return;
			}

			setSelectedWpcomSiteAssistantConversationId( chatTarget.id, conversationId );
			selectChatTarget( chatTarget );
			notifyWpcomSiteAssistantSessionStateUpdated( chatTarget.id );
		},
		[ chatTarget, selectChatTarget ]
	);

	const startNewConversation = useCallback( () => {
		if ( ! chatTarget ) {
			return;
		}

		createNewWpcomSiteAssistantConversation( chatTarget );
		selectChatTarget( chatTarget );
		notifyWpcomSiteAssistantSessionStateUpdated( chatTarget.id );
	}, [ chatTarget, selectChatTarget ] );

	const deleteConversation = useCallback(
		( conversationId: string ) => {
			if ( ! chatTarget || getWpcomSiteAssistantTurn( conversationId ) ) {
				return;
			}

			deleteWpcomSiteAssistantConversation( conversationId, chatTarget );
			notifyWpcomSiteAssistantSessionStateUpdated( chatTarget.id );
			setChatListVersion( ( version ) => version + 1 );
		},
		[ chatTarget ]
	);

	const runLocalOpenCommand = useCallback(
		async ( path = '', autoLogin = false ) => {
			if ( ! localSite || isLocalSiteLoading || isLocalSiteAdding ) {
				return;
			}

			if ( ! localSite.running ) {
				await startServer( localSite );
			}
			getIpcApi().openSiteURL( localSite.id, path, { autoLogin } );
		},
		[ isLocalSiteAdding, isLocalSiteLoading, localSite, startServer ]
	);

	const groups = useMemo< WorkspaceSidebarCommandGroup[] >( () => {
		if ( ! context?.anchor ) {
			return [];
		}

		const finderLabel = isWindows() ? __( 'File Explorer' ) : __( 'Finder' );
		const terminalLabel = getTerminalName( terminal );
		const editorLabel =
			editor && supportedEditorConfig[ editor ] ? supportedEditorConfig[ editor ].label : null;
		const openCommands: WorkspaceSidebarCommand[] = [];
		const targetCommands: WorkspaceSidebarCommand[] = [];
		const syncCommands: WorkspaceSidebarCommand[] = [];
		const manageCommands: WorkspaceSidebarCommand[] = [];

		if ( localSite ) {
			openCommands.push(
				localSite.running
					? {
							id: 'stop-local-site',
							label: __( 'Stop local site' ),
							disabled: isLocalSiteAdding,
							disabledReason: isLocalSiteAdding ? __( 'Site is still being added.' ) : undefined,
							onSelect: () => {
								void stopServer( localSite.id );
							},
					  }
					: {
							id: 'start-local-site',
							label: __( 'Start local site' ),
							disabled: isLocalSiteLoading || isLocalSiteAdding,
							disabledReason: isLocalSiteLoading
								? __( 'Site is starting.' )
								: isLocalSiteAdding
								? __( 'Site is still being added.' )
								: undefined,
							onSelect: () => {
								void startServer( localSite );
							},
					  },
				{
					id: 'open-local-site',
					label: __( 'Open local site' ),
					disabled: ! canUseLocalSiteCommands || isLocalSiteLoading,
					disabledReason: isLocalSiteLoading ? __( 'Site is starting.' ) : undefined,
					onSelect: () => void runLocalOpenCommand( '', false ),
				},
				{
					id: 'open-local-admin',
					label: __( 'Open local WP admin' ),
					disabled: ! canUseLocalSiteCommands || isLocalSiteLoading,
					disabledReason: isLocalSiteLoading ? __( 'Site is starting.' ) : undefined,
					onSelect: () => void runLocalOpenCommand( '/wp-admin/', true ),
				},
				{
					id: 'open-finder',
					label: sprintf(
						/* translators: %s is the name of the file explorer. E.g. "Open in Finder" */
						__( 'Open in %s' ),
						finderLabel
					),
					disabled: ! canUseLocalSiteCommands,
					onSelect: () => {
						getIpcApi().openLocalPath( localSite.path );
					},
				}
			);

			if ( editorLabel ) {
				openCommands.push( {
					id: 'open-editor',
					label: sprintf(
						/* translators: %s is the name of the editor. E.g. "Open in Cursor" */
						__( 'Open in %s' ),
						editorLabel
					),
					disabled: ! canUseLocalSiteCommands,
					onSelect: () => {
						if ( editor ) {
							void getIpcApi().openAppAtPath( editor, localSite.path );
						}
					},
				} );
			}

			openCommands.push( {
				id: 'open-terminal',
				label: sprintf(
					/* translators: %s is the name of the terminal app. E.g. "Open in Terminal" */
					__( 'Open in %s' ),
					terminalLabel
				),
				disabled: ! canUseLocalSiteCommands,
				onSelect: async () => {
					try {
						await getIpcApi().openTerminalAtPath( localSite.path );
					} catch ( error ) {
						Sentry.captureException( error );
						alert( __( 'Could not open the terminal.' ) );
					}
				},
			} );

			manageCommands.push(
				{
					id: 'edit-local-site',
					label: __( 'Edit site…' ),
					disabled: ! canUseLocalSiteCommands,
					onSelect: () => {
						if ( localSite.id !== selectedSite?.id ) {
							setSelectedSiteId( localSite.id );
						}
						setSelectedTab( 'settings' );
						setIsEditModalOpen( true );
					},
				},
				{
					id: 'copy-local-site',
					label: __( 'Copy site…' ),
					disabled: isLocalSiteLoading || isLocalSiteAdding || isAnySiteAdding,
					disabledReason: isLocalSiteLoading
						? __( 'Site is loading.' )
						: isAnySiteAdding
						? __( 'Wait for site creation to finish before copying a site.' )
						: undefined,
					onSelect: async () => {
						try {
							await copySite( localSite.id );
						} catch ( error ) {
							Sentry.captureException( error );
						}
					},
				},
				{
					id: 'delete-local-site',
					label: __( 'Delete site…' ),
					destructive: true,
					disabled:
						isLocalSiteLoading || isLocalSiteAdding || isAnySiteAdding || isLocalSiteSyncing,
					disabledReason: isLocalSiteLoading
						? __( 'Site is loading.' )
						: isLocalSiteSyncing
						? __( 'Wait for sync to finish before deleting a site.' )
						: isAnySiteAdding
						? __( 'Wait for site creation to finish before deleting a site.' )
						: undefined,
					onSelect: () => handleDeleteSite( localSite.id, localSite.name ),
				}
			);
		}

		if ( chatTarget ) {
			openCommands.push(
				{
					id: 'open-remote-site',
					label: __( 'Open WordPress.com site' ),
					secondary: chatTarget.url,
					icon: <Icon icon={ external } size={ 16 } />,
					onSelect: () => {
						getIpcApi().openURL( chatTarget.url );
					},
				},
				{
					id: 'open-remote-admin',
					label: __( 'Open WordPress.com WP admin' ),
					secondary: resolveRemoteSiteUrl( chatTarget, '/wp-admin/' ),
					icon: <Icon icon={ wordpress } size={ 16 } />,
					onSelect: () => {
						getIpcApi().openURL( resolveRemoteSiteUrl( chatTarget, '/wp-admin/' ) );
					},
				}
			);
		}

		if ( workspace ) {
			targetCommands.push( {
				id: 'select-local-target',
				label: __( 'Local' ),
				secondary: workspaceLocalSite?.path,
				active:
					Boolean( workspaceLocalSite ) &&
					( isLocalTargetSaved ||
						( ! selectedWpcomSite && selectedSite?.id === workspaceLocalSite?.id ) ),
				disabled: ! workspaceLocalSite,
				disabledReason: workspaceLocalSite
					? undefined
					: __( 'No local site is connected to this workspace yet.' ),
				onSelect: selectLocalTarget,
			} );

			if ( productionSite ) {
				targetCommands.push( {
					id: 'select-production-target',
					label: __( 'Production' ),
					secondary: productionSite.url,
					active:
						productionSite.id === selectedWpcomSite?.id ||
						savedRemoteTarget?.id === productionSite.id,
					onSelect: () => selectRemoteTarget( productionSite ),
				} );
			}

			if ( stagingSite ) {
				targetCommands.push( {
					id: 'select-staging-target',
					label: __( 'Staging' ),
					secondary: stagingSite.url,
					active:
						stagingSite.id === selectedWpcomSite?.id || savedRemoteTarget?.id === stagingSite.id,
					onSelect: () => selectRemoteTarget( stagingSite ),
				} );
			} else if ( productionSite && isStagingUpgradeAvailable ) {
				targetCommands.push( {
					id: 'upgrade-staging-target',
					label: __( 'Upgrade to add Staging' ),
					secondary: __( "This site's plan does not include staging sites." ),
					onSelect: () => {
						getIpcApi().openURL( getStagingPlanUpgradeUrl( productionSite ) );
					},
				} );
			} else {
				targetCommands.push( {
					id: 'create-staging-target',
					label: isStagingCreateInFlight ? __( 'Creating Staging...' ) : __( 'Create Staging' ),
					secondary: __( 'Create a staging site for this workspace.' ),
					disabled: ! canCreateStagingSite || isStagingCreateInFlight,
					disabledReason: stagingTargetDisabledReason,
					isLoading: isStagingCreateInFlight,
					onSelect: () => void createStagingSite(),
				} );
			}

			syncCommands.push( {
				id: 'open-workspace-sync',
				label: __( 'Workspace sync' ),
				secondary: __( 'Sync Local, Production, and Staging targets.' ),
				onSelect: () => onOpenSync( workspace ),
			} );
		}

		return [
			{ id: 'open', label: __( 'Open' ), commands: openCommands },
			{ id: 'targets', label: __( 'Targets' ), commands: targetCommands },
			{ id: 'sync', label: __( 'Sync' ), commands: syncCommands },
			{ id: 'manage', label: __( 'Manage' ), commands: manageCommands },
		];
	}, [
		canCreateStagingSite,
		canUseLocalSiteCommands,
		chatTarget,
		context?.anchor,
		copySite,
		createStagingSite,
		editor,
		handleDeleteSite,
		isAnySiteAdding,
		isLocalSiteAdding,
		isLocalSiteLoading,
		isLocalSiteSyncing,
		isLocalTargetSaved,
		isStagingCreateInFlight,
		isStagingUpgradeAvailable,
		localSite,
		onOpenSync,
		productionSite,
		runLocalOpenCommand,
		savedRemoteTarget?.id,
		selectLocalTarget,
		selectRemoteTarget,
		selectedSite?.id,
		selectedWpcomSite,
		setIsEditModalOpen,
		setSelectedSiteId,
		setSelectedTab,
		stagingSite,
		stagingTargetDisabledReason,
		startServer,
		stopServer,
		terminal,
		workspace,
		workspaceLocalSite,
	] );

	if ( ! context?.anchor ) {
		return null;
	}

	return (
		<Popover
			anchor={ context.anchor }
			placement="right-start"
			onClose={ onClose }
			resize
			shift
			offset={ 8 }
			focusOnMount={ false }
		>
			<div
				ref={ menuRef }
				role="menu"
				aria-label={ __( 'Workspace commands' ) }
				className="max-h-[min(32rem,calc(100vh-2rem))] w-80 overflow-y-auto rounded border border-a8c-gray-5 bg-white p-1 shadow-lg"
			>
				{ groups.map( ( group ) => (
					<CommandGroup key={ group.id } group={ group } onClose={ onClose } />
				) ) }
				{ chatTarget && (
					<div className="border-t border-a8c-gray-5 py-1">
						<div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-frame-text-secondary">
							{ __( 'Chats' ) }
						</div>
						{ selectedConversationForChatTarget && selectedConversationIdForChatTarget && (
							<CommandRow
								command={ {
									id: 'open-current-chat',
									label: __( 'Open current chat' ),
									secondary: getWpcomSiteAssistantConversationLabel(
										selectedConversationForChatTarget
									),
									onSelect: () => selectConversation( selectedConversationIdForChatTarget ),
								} }
								onClose={ onClose }
							/>
						) }
						<CommandRow
							command={ {
								id: 'new-chat',
								label: __( 'New chat' ),
								secondary: chatTarget.name,
								icon: <Icon icon={ plus } size={ 16 } />,
								onSelect: startNewConversation,
							} }
							onClose={ onClose }
						/>
						{ showChatCommands &&
							conversationsForChatTarget.slice( 0, 5 ).map( ( conversation ) => {
								const isActiveTurn = Boolean( getWpcomSiteAssistantTurn( conversation.id ) );
								const isSelected =
									conversation.id === selectedConversationIdForChatTarget &&
									chatTarget.id === selectedWpcomSite?.id;

								return (
									<div
										key={ conversation.id }
										className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-1 rounded px-2 py-1 hover:bg-frame-surface"
									>
										<button
											type="button"
											role="menuitem"
											className="min-w-0 rounded px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
											onClick={ () => {
												selectConversation( conversation.id );
												onClose();
											} }
										>
											<span className="flex min-w-0 items-center gap-2">
												<span className="min-w-0 flex-1 truncate text-sm font-medium text-frame-text">
													{ getWpcomSiteAssistantConversationLabel( conversation ) }
												</span>
												{ isSelected && <Icon icon={ check } size={ 14 } /> }
											</span>
											<span className="block truncate text-xs text-frame-text-secondary">
												{ isActiveTurn
													? __( 'Dolly is thinking' )
													: getWpcomSiteAssistantConversationUpdatedLabel( conversation ) }
											</span>
										</button>
										<Button
											variant="icon"
											className="h-8 w-8 text-frame-text-secondary hover:text-a8c-red-50"
											disabled={ isActiveTurn }
											tooltipText={
												isActiveTurn
													? __( 'Wait for Dolly to finish before deleting this chat.' )
													: undefined
											}
											aria-label={ sprintf(
												/* translators: %s is a Dolly chat label. */
												__( 'Delete chat: %s' ),
												getWpcomSiteAssistantConversationMenuLabel( conversation )
											) }
											onClick={ () => deleteConversation( conversation.id ) }
										>
											<Icon icon={ trash } size={ 18 } />
										</Button>
									</div>
								);
							} ) }
					</div>
				) }
			</div>
		</Popover>
	);
}
