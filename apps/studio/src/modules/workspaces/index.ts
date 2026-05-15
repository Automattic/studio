export {
	buildStudioWorkspaces,
	createStudioWorkspaceId,
	mergeWpcomSitesWithConnectedSites,
} from 'src/modules/workspaces/lib/build-studio-workspaces';
export {
	getDefaultWorkspaceTargetId,
	getWorkspaceTargetStorageKey,
	isWorkspaceTargetAvailable,
} from 'src/modules/workspaces/lib/target-selection';
export { useSidebarWorkspaces } from 'src/modules/workspaces/hooks/use-sidebar-workspaces';
export {
	useWorkspaceSelection,
	WorkspaceSelectionProvider,
} from 'src/modules/workspaces/hooks/use-workspace-selection';
export { useWorkspaceTargetSelection } from 'src/modules/workspaces/hooks/use-workspace-target-selection';
export {
	getDefaultWorkspaceTargetTabId,
	getWorkspaceTargetTabIds,
	getWorkspaceTargetTabStorageKey,
	isWorkspaceTargetTabId,
	LOCAL_WORKSPACE_TAB_IDS,
	REMOTE_WORKSPACE_TAB_IDS,
} from 'src/modules/workspaces/lib/workspace-tabs';
export type {
	BuildStudioWorkspacesInput,
	LocalTarget,
	RemoteTarget,
	StudioWorkspace,
	WorkspaceActivity,
	WorkspaceSyncLink,
	WorkspaceTargetId,
} from 'src/modules/workspaces/types';
