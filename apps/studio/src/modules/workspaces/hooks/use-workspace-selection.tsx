import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useSidebarWorkspaces } from 'src/modules/workspaces/hooks/use-sidebar-workspaces';
import { useWorkspaceTargetSelection } from 'src/modules/workspaces/hooks/use-workspace-target-selection';
import {
	getDefaultWorkspaceTargetId,
	isWorkspaceTargetAvailable,
} from 'src/modules/workspaces/lib/target-selection';
import {
	getDefaultWorkspaceTargetTabId,
	getWorkspaceTargetTabStorageKey,
	isWorkspaceTargetTabId,
} from 'src/modules/workspaces/lib/workspace-tabs';
import type { TabName } from 'src/hooks/use-content-tabs';
import type {
	LocalTarget,
	RemoteTarget,
	StudioWorkspace,
	WorkspaceTargetId,
} from 'src/modules/workspaces/types';

type WorkspaceTarget = LocalTarget | RemoteTarget;

type WorkspaceSelectionContextValue = {
	enableWorkspaces: boolean;
	workspaces: StudioWorkspace[];
	isLoading: boolean;
	selectedWorkspace?: StudioWorkspace;
	selectedWorkspaceId?: string;
	selectedTargetId?: WorkspaceTargetId;
	selectedTarget?: WorkspaceTarget;
	getSelectedTargetId: ( workspace: StudioWorkspace ) => WorkspaceTargetId | undefined;
	selectWorkspaceTarget: ( workspaceId: string, targetId: WorkspaceTargetId ) => void;
	selectedTabId?: TabName;
	selectWorkspaceTab: ( workspaceId: string, targetId: WorkspaceTargetId, tabId: TabName ) => void;
};

const WorkspaceSelectionContext = createContext< WorkspaceSelectionContextValue | undefined >(
	undefined
);

function readSavedTabId( workspaceId: string, targetId: WorkspaceTargetId ): TabName | undefined {
	try {
		const savedTabId = localStorage.getItem(
			getWorkspaceTargetTabStorageKey( workspaceId, targetId )
		);
		if (
			savedTabId === 'overview' ||
			savedTabId === 'sync' ||
			savedTabId === 'settings' ||
			savedTabId === 'assistant' ||
			savedTabId === 'import-export' ||
			savedTabId === 'previews'
		) {
			return savedTabId;
		}
	} catch {
		return undefined;
	}

	return undefined;
}

function writeSavedTabId( workspaceId: string, targetId: WorkspaceTargetId, tabId: TabName ) {
	try {
		localStorage.setItem( getWorkspaceTargetTabStorageKey( workspaceId, targetId ), tabId );
	} catch {
		// Ignore storage failures; selection still works for the current render.
	}
}

function getWorkspaceTargetKey( workspaceId: string, targetId: WorkspaceTargetId ) {
	return `${ workspaceId }:${ targetId }`;
}

export function WorkspaceSelectionProvider( { children }: { children: ReactNode } ) {
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const { enableWorkspaces, sidebarWorkspaces: workspaces, isLoading } = useSidebarWorkspaces();
	const {
		selectedWorkspaceId: explicitSelectedWorkspaceId,
		getSelectedTargetId,
		selectWorkspaceTarget: selectTarget,
	} = useWorkspaceTargetSelection( workspaces );
	const [ selectedTabs, setSelectedTabs ] = useState< Record< string, TabName > >( {} );
	const selectedSiteId = selectedSite?.id;

	const selectedWorkspace = useMemo( () => {
		const explicitWorkspace = workspaces.find(
			( workspace ) => workspace.id === explicitSelectedWorkspaceId
		);
		if ( explicitWorkspace ) {
			return explicitWorkspace;
		}

		if ( selectedSiteId ) {
			const selectedSiteWorkspace = workspaces.find(
				( workspace ) => workspace.targets.local?.siteId === selectedSiteId
			);
			if ( selectedSiteWorkspace ) {
				return selectedSiteWorkspace;
			}
		}

		return workspaces[ 0 ];
	}, [ explicitSelectedWorkspaceId, selectedSiteId, workspaces ] );

	const selectedTargetId = selectedWorkspace ? getSelectedTargetId( selectedWorkspace ) : undefined;

	const getSelectedTabId = useCallback(
		( workspaceId: string, targetId: WorkspaceTargetId ) => {
			const selectedTabId =
				selectedTabs[ getWorkspaceTargetKey( workspaceId, targetId ) ] ??
				readSavedTabId( workspaceId, targetId );

			if ( selectedTabId && isWorkspaceTargetTabId( targetId, selectedTabId ) ) {
				return selectedTabId;
			}

			return getDefaultWorkspaceTargetTabId( targetId );
		},
		[ selectedTabs ]
	);

	const selectedTabId =
		selectedWorkspace && selectedTargetId
			? getSelectedTabId( selectedWorkspace.id, selectedTargetId )
			: undefined;

	const selectWorkspaceTarget = useCallback(
		( workspaceId: string, targetId: WorkspaceTargetId ) => {
			const workspace = workspaces.find( ( candidate ) => candidate.id === workspaceId );
			if ( ! workspace || ! isWorkspaceTargetAvailable( workspace, targetId ) ) {
				return;
			}

			selectTarget( workspaceId, targetId );
			if ( targetId === 'local' && workspace.targets.local ) {
				setSelectedSiteId( workspace.targets.local.siteId );
			}
		},
		[ selectTarget, setSelectedSiteId, workspaces ]
	);

	const selectWorkspaceTab = useCallback(
		( workspaceId: string, targetId: WorkspaceTargetId, tabId: TabName ) => {
			if ( ! isWorkspaceTargetTabId( targetId, tabId ) ) {
				return;
			}

			setSelectedTabs( ( current ) => ( {
				...current,
				[ getWorkspaceTargetKey( workspaceId, targetId ) ]: tabId,
			} ) );
			writeSavedTabId( workspaceId, targetId, tabId );
		},
		[]
	);

	const value = useMemo< WorkspaceSelectionContextValue >( () => {
		const fallbackTargetId =
			selectedWorkspace && ! selectedTargetId
				? getDefaultWorkspaceTargetId( selectedWorkspace )
				: selectedTargetId;

		return {
			enableWorkspaces,
			workspaces,
			isLoading,
			selectedWorkspace,
			selectedWorkspaceId: selectedWorkspace?.id,
			selectedTargetId: fallbackTargetId,
			selectedTarget: fallbackTargetId ? selectedWorkspace?.targets[ fallbackTargetId ] : undefined,
			getSelectedTargetId,
			selectWorkspaceTarget,
			selectedTabId,
			selectWorkspaceTab,
		};
	}, [
		enableWorkspaces,
		getSelectedTargetId,
		isLoading,
		selectWorkspaceTab,
		selectWorkspaceTarget,
		selectedTabId,
		selectedTargetId,
		selectedWorkspace,
		workspaces,
	] );

	return (
		<WorkspaceSelectionContext.Provider value={ value }>
			{ children }
		</WorkspaceSelectionContext.Provider>
	);
}

export function useWorkspaceSelection() {
	const context = useContext( WorkspaceSelectionContext );
	if ( ! context ) {
		throw new Error( 'useWorkspaceSelection must be used within a WorkspaceSelectionProvider' );
	}

	return context;
}
