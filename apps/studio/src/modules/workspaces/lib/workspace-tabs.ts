import type { TabName } from 'src/hooks/use-content-tabs';
import type { WorkspaceTargetId } from 'src/modules/workspaces/types';

const WORKSPACE_TARGET_TAB_STORAGE_PREFIX = 'studio-workspace-target-tab:';

export const LOCAL_WORKSPACE_TAB_IDS: TabName[] = [
	'overview',
	'sync',
	'previews',
	'import-export',
	'settings',
	'assistant',
];

export const REMOTE_WORKSPACE_TAB_IDS: TabName[] = [ 'assistant', 'sync', 'settings' ];

export function getWorkspaceTargetTabIds( targetId: WorkspaceTargetId ): TabName[] {
	return targetId === 'local' ? LOCAL_WORKSPACE_TAB_IDS : REMOTE_WORKSPACE_TAB_IDS;
}

export function isWorkspaceTargetTabId( targetId: WorkspaceTargetId, tabId: TabName ) {
	return getWorkspaceTargetTabIds( targetId ).includes( tabId );
}

export function getDefaultWorkspaceTargetTabId( targetId: WorkspaceTargetId ): TabName {
	return targetId === 'local' ? 'overview' : 'assistant';
}

export function getWorkspaceTargetTabStorageKey(
	workspaceId: string,
	targetId: WorkspaceTargetId
) {
	return `${ WORKSPACE_TARGET_TAB_STORAGE_PREFIX }${ workspaceId }:${ targetId }`;
}
