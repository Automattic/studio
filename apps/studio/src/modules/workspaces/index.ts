export {
	buildStudioWorkspaces,
	createStudioWorkspaceId,
	mergeWpcomSitesWithConnectedSites,
} from 'src/modules/workspaces/lib/build-studio-workspaces';
export { useSidebarWorkspaces } from 'src/modules/workspaces/hooks/use-sidebar-workspaces';
export {
	useWorkspaceSelection,
	WorkspaceSelectionProvider,
} from 'src/modules/workspaces/hooks/use-workspace-selection';
export type {
	BuildStudioWorkspacesInput,
	LocalTarget,
	RemoteTarget,
	StudioWorkspace,
	WorkspaceActivity,
	WorkspaceSyncLink,
	WorkspaceTargetId,
} from 'src/modules/workspaces/types';
