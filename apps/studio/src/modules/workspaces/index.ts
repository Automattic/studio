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
export { useWorkspaceTargetSelection } from 'src/modules/workspaces/hooks/use-workspace-target-selection';
export type {
	BuildStudioWorkspacesInput,
	LocalTarget,
	RemoteTarget,
	StudioWorkspace,
	WorkspaceActivity,
	WorkspaceSyncLink,
	WorkspaceTargetId,
} from 'src/modules/workspaces/types';
