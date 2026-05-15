import type { StudioWorkspace, WorkspaceTargetId } from 'src/modules/workspaces/types';

const WORKSPACE_TARGET_STORAGE_PREFIX = 'studio-workspace-target:';

export function getDefaultWorkspaceTargetId(
	workspace: StudioWorkspace
): WorkspaceTargetId | undefined {
	if ( workspace.targets.local ) {
		return 'local';
	}

	if ( workspace.targets.production ) {
		return 'production';
	}

	if ( workspace.targets.staging ) {
		return 'staging';
	}

	return undefined;
}

export function isWorkspaceTargetAvailable(
	workspace: StudioWorkspace,
	targetId: WorkspaceTargetId
) {
	return Boolean( workspace.targets[ targetId ] );
}

export function getWorkspaceTargetStorageKey( workspaceId: string ) {
	return `${ WORKSPACE_TARGET_STORAGE_PREFIX }${ workspaceId }`;
}
