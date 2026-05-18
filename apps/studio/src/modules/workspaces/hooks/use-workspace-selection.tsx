import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useSidebarWorkspaces } from 'src/modules/workspaces/hooks/use-sidebar-workspaces';
import {
	getDefaultWorkspaceTabId,
	getWorkspaceTabStorageKey,
	isWorkspaceTabId,
} from 'src/modules/workspaces/lib/workspace-tabs';
import type { TabName } from 'src/hooks/use-content-tabs';
import type { StudioWorkspace } from 'src/modules/workspaces/types';

type WorkspaceSelectionContextValue = {
	enableWorkspaces: boolean;
	workspaces: StudioWorkspace[];
	isLoading: boolean;
	selectedWorkspace?: StudioWorkspace;
	selectedWorkspaceId?: string;
	selectWorkspace: ( workspaceId: string ) => void;
	selectedTabId?: TabName;
	selectWorkspaceTab: ( workspaceId: string, tabId: TabName ) => void;
	refreshWorkspaces: () => void;
};

const WorkspaceSelectionContext = createContext< WorkspaceSelectionContextValue | undefined >(
	undefined
);

function readSavedTabId( workspace: StudioWorkspace ): TabName | undefined {
	try {
		const savedTabId = localStorage.getItem( getWorkspaceTabStorageKey( workspace.id ) );
		if (
			savedTabId === 'overview' ||
			savedTabId === 'sync' ||
			savedTabId === 'settings' ||
			savedTabId === 'assistant' ||
			savedTabId === 'import-export' ||
			savedTabId === 'previews'
		) {
			return isWorkspaceTabId( workspace, savedTabId ) ? savedTabId : undefined;
		}
	} catch {
		return undefined;
	}

	return undefined;
}

function writeSavedTabId( workspaceId: string, tabId: TabName ) {
	try {
		localStorage.setItem( getWorkspaceTabStorageKey( workspaceId ), tabId );
	} catch {
		// Ignore storage failures; selection still works for the current render.
	}
}

export function WorkspaceSelectionProvider( { children }: { children: ReactNode } ) {
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const {
		enableWorkspaces,
		sidebarWorkspaces: workspaces,
		isLoading,
		refreshWorkspaces,
	} = useSidebarWorkspaces();
	const [ explicitSelectedWorkspaceId, setExplicitSelectedWorkspaceId ] = useState< string >();
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

	const selectedTabId = useMemo( () => {
		if ( ! selectedWorkspace ) {
			return undefined;
		}

		const selectedTab = selectedTabs[ selectedWorkspace.id ] ?? readSavedTabId( selectedWorkspace );

		if ( selectedTab && isWorkspaceTabId( selectedWorkspace, selectedTab ) ) {
			return selectedTab;
		}

		return getDefaultWorkspaceTabId( selectedWorkspace );
	}, [ selectedTabs, selectedWorkspace ] );

	const selectWorkspace = useCallback(
		( workspaceId: string ) => {
			const workspace = workspaces.find( ( candidate ) => candidate.id === workspaceId );
			if ( ! workspace ) {
				return;
			}

			setExplicitSelectedWorkspaceId( workspaceId );
			if ( workspace.targets.local ) {
				setSelectedSiteId( workspace.targets.local.siteId );
			}
		},
		[ setSelectedSiteId, workspaces ]
	);

	const selectWorkspaceTab = useCallback(
		( workspaceId: string, tabId: TabName ) => {
			const workspace = workspaces.find( ( candidate ) => candidate.id === workspaceId );
			if ( ! workspace || ! isWorkspaceTabId( workspace, tabId ) ) {
				return;
			}

			setSelectedTabs( ( current ) => ( {
				...current,
				[ workspaceId ]: tabId,
			} ) );
			writeSavedTabId( workspaceId, tabId );
		},
		[ workspaces ]
	);

	const value = useMemo< WorkspaceSelectionContextValue >( () => {
		return {
			enableWorkspaces,
			workspaces,
			isLoading,
			selectedWorkspace,
			selectedWorkspaceId: selectedWorkspace?.id,
			selectWorkspace,
			selectedTabId,
			selectWorkspaceTab,
			refreshWorkspaces,
		};
	}, [
		enableWorkspaces,
		isLoading,
		refreshWorkspaces,
		selectWorkspaceTab,
		selectWorkspace,
		selectedTabId,
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
