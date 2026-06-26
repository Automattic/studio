import { __ } from '@wordpress/i18n';
import { type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import type { ResizableWorkbenchColumn, WorkbenchSidebarTab } from './types';

type WorkbenchSidebarProps = {
	sidebarTab: WorkbenchSidebarTab;
	reviewPatchCount: number;
	resizingColumn: ResizableWorkbenchColumn | null;
	children: ReactNode;
	onSelectSidebarTab: ( tab: WorkbenchSidebarTab ) => void;
	onResizePointerDown: (
		column: ResizableWorkbenchColumn,
		event: PointerEvent< HTMLButtonElement >
	) => void;
	onResizeKeyDown: (
		column: ResizableWorkbenchColumn,
		event: KeyboardEvent< HTMLButtonElement >
	) => void;
	onResetSidebarWidth: () => void;
};

export function WorkbenchSidebar( {
	sidebarTab,
	reviewPatchCount,
	resizingColumn,
	children,
	onSelectSidebarTab,
	onResizePointerDown,
	onResizeKeyDown,
	onResetSidebarWidth,
}: WorkbenchSidebarProps ) {
	return (
		<aside className={ workbenchStyles.sidebar }>
			<button
				type="button"
				className={ cx(
					workbenchStyles.resizeHandle,
					workbenchStyles.resizeHandleSidebar,
					resizingColumn === 'sidebar' && workbenchStyles.resizeHandleActive
				) }
				aria-label={ __( 'Resize sidebar' ) }
				title={ __( 'Resize sidebar' ) }
				onPointerDown={ ( event ) => onResizePointerDown( 'sidebar', event ) }
				onDoubleClick={ onResetSidebarWidth }
				onKeyDown={ ( event ) => onResizeKeyDown( 'sidebar', event ) }
			/>
			<div className={ workbenchStyles.sidebarTabs }>
				<button
					type="button"
					className={ cx(
						workbenchStyles.sidebarTab,
						sidebarTab === 'ai' && workbenchStyles.sidebarTabActive
					) }
					onClick={ () => onSelectSidebarTab( 'ai' ) }
				>
					{ __( 'Studio Code' ) }
				</button>
				<button
					type="button"
					className={ cx(
						workbenchStyles.sidebarTab,
						sidebarTab === 'releases' && workbenchStyles.sidebarTabActive
					) }
					onClick={ () => onSelectSidebarTab( 'releases' ) }
				>
					{ __( 'Releases' ) }
				</button>
				{ reviewPatchCount > 0 && (
					<button
						type="button"
						className={ cx(
							workbenchStyles.sidebarTab,
							sidebarTab === 'review' && workbenchStyles.sidebarTabActive
						) }
						onClick={ () => onSelectSidebarTab( 'review' ) }
					>
						{ __( 'Review' ) }
					</button>
				) }
			</div>
			{ children }
		</aside>
	);
}
