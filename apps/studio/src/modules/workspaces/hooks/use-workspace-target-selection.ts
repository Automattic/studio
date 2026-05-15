import { useCallback, useMemo, useState } from 'react';
import {
	getDefaultWorkspaceTargetId,
	getWorkspaceTargetStorageKey,
	isWorkspaceTargetAvailable,
} from 'src/modules/workspaces/lib/target-selection';
import type { StudioWorkspace, WorkspaceTargetId } from 'src/modules/workspaces/types';

function readSavedTargetId( workspace: StudioWorkspace ): WorkspaceTargetId | undefined {
	try {
		const savedTargetId = localStorage.getItem( getWorkspaceTargetStorageKey( workspace.id ) );
		if (
			savedTargetId === 'local' ||
			savedTargetId === 'production' ||
			savedTargetId === 'staging'
		) {
			return savedTargetId;
		}
	} catch {
		return undefined;
	}

	return undefined;
}

function writeSavedTargetId( workspaceId: string, targetId: WorkspaceTargetId ) {
	try {
		localStorage.setItem( getWorkspaceTargetStorageKey( workspaceId ), targetId );
	} catch {
		// Ignore storage failures; selection still works for the current render.
	}
}

export function useWorkspaceTargetSelection( workspaces: StudioWorkspace[] ) {
	const [ selectedWorkspaceId, setSelectedWorkspaceId ] = useState< string | null >( null );
	const [ selectedTargets, setSelectedTargets ] = useState< Record< string, WorkspaceTargetId > >(
		{}
	);
	const workspacesById = useMemo(
		() => new Map( workspaces.map( ( workspace ) => [ workspace.id, workspace ] ) ),
		[ workspaces ]
	);

	const getSelectedTargetId = useCallback(
		( workspace: StudioWorkspace ) => {
			const selectedTargetId = selectedTargets[ workspace.id ] ?? readSavedTargetId( workspace );
			if ( selectedTargetId && isWorkspaceTargetAvailable( workspace, selectedTargetId ) ) {
				return selectedTargetId;
			}

			return getDefaultWorkspaceTargetId( workspace );
		},
		[ selectedTargets ]
	);

	const selectWorkspaceTarget = useCallback(
		( workspaceId: string, targetId: WorkspaceTargetId ) => {
			const workspace = workspacesById.get( workspaceId );
			if ( ! workspace || ! isWorkspaceTargetAvailable( workspace, targetId ) ) {
				return;
			}

			setSelectedWorkspaceId( workspaceId );
			setSelectedTargets( ( current ) => ( {
				...current,
				[ workspaceId ]: targetId,
			} ) );
			writeSavedTargetId( workspaceId, targetId );
		},
		[ workspacesById ]
	);

	return {
		selectedWorkspaceId,
		getSelectedTargetId,
		selectWorkspaceTarget,
	};
}
