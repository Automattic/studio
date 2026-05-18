import type { TabName } from 'src/hooks/use-content-tabs';
import type { StudioWorkspace } from 'src/modules/workspaces/types';

const WORKSPACE_TAB_STORAGE_PREFIX = 'studio-workspace-tab:';

export const LOCAL_WORKSPACE_TAB_IDS: TabName[] = [
	'overview',
	'assistant',
	'sync',
	'previews',
	'import-export',
	'settings',
];

export const REMOTE_WORKSPACE_TAB_IDS: TabName[] = [ 'assistant', 'sync', 'settings' ];

export function getWorkspaceTabIds( workspace: StudioWorkspace ): TabName[] {
	return workspace.targets.local ? LOCAL_WORKSPACE_TAB_IDS : REMOTE_WORKSPACE_TAB_IDS;
}

export function isWorkspaceTabId( workspace: StudioWorkspace, tabId: TabName ) {
	return getWorkspaceTabIds( workspace ).includes( tabId );
}

export function getDefaultWorkspaceTabId( workspace: StudioWorkspace ): TabName {
	return workspace.targets.local ? 'overview' : 'assistant';
}

export function getWorkspaceTabStorageKey( workspaceId: string ) {
	return `${ WORKSPACE_TAB_STORAGE_PREFIX }${ workspaceId }`;
}
