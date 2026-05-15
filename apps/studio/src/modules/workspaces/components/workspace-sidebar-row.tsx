import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { WorkspaceTargetIndicators } from 'src/modules/workspaces/components/workspace-target-indicators';
import type { ReactNode } from 'react';
import type { StudioWorkspace, WorkspaceTargetId } from 'src/modules/workspaces/types';

type WorkspaceSidebarRowProps = {
	workspace: StudioWorkspace;
	selectedTargetId?: WorkspaceTargetId;
	isSelected: boolean;
	localRunControl?: ReactNode;
	onSelectTarget: ( targetId: WorkspaceTargetId ) => void;
};

export function WorkspaceSidebarRow( {
	workspace,
	selectedTargetId,
	isSelected,
	localRunControl,
	onSelectTarget,
}: WorkspaceSidebarRowProps ) {
	return (
		<li
			className={ cx(
				'flex flex-row min-w-[168px] h-8 hover:bg-[#ffffff0C] rounded transition-all ms-1 items-center',
				isMac() ? 'me-5' : 'me-4',
				isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
			) }
		>
			<button
				type="button"
				className="p-2 text-xs rounded-tl rounded-bl whitespace-nowrap overflow-hidden text-ellipsis w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
				onClick={ () => {
					if ( selectedTargetId ) {
						onSelectTarget( selectedTargetId );
					}
				} }
			>
				{ workspace.name }
			</button>
			<WorkspaceTargetIndicators
				workspace={ workspace }
				selectedTargetId={ selectedTargetId }
				onSelectTarget={ onSelectTarget }
			/>
			{ localRunControl }
		</li>
	);
}
