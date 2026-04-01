import { Button } from '@wordpress/components';
import {
	chevronLeft,
	chevronRight,
	cog,
	drawerLeft,
	drawerRight,
	moreHorizontal,
	reset,
} from '@wordpress/icons';
import { type RefObject } from 'react';
import { Group, Panel, type PanelImperativeHandle, Separator } from 'react-resizable-panels';
import { isMac } from 'src/lib/app-globals';
import { Toolbar } from './toolbar';

export function togglePanel(
	panel: PanelImperativeHandle | null,
	onToggle?: ( willCollapse: boolean ) => void
) {
	if ( ! panel ) return;

	const panels = document.querySelectorAll( '[data-panel]' );
	panels.forEach( ( el ) => el.classList.add( 'panel-animating' ) );

	const willCollapse = ! panel.isCollapsed();
	onToggle?.( willCollapse );

	if ( willCollapse ) {
		panel.collapse();
	} else {
		panel.expand();
	}

	setTimeout( () => {
		panels.forEach( ( el ) => el.classList.remove( 'panel-animating' ) );
	}, 250 );
}

const ICON_CHROME = 'app-no-drag-region text-chrome-text-secondary';
const ICON_FRAME = 'app-no-drag-region text-frame-text-secondary';

interface PanelLayoutProps {
	navPanelRef: RefObject< PanelImperativeHandle | null >;
	secondaryPanelRef: RefObject< PanelImperativeHandle | null >;
	navCollapsed: boolean;
	onToggleNav: () => void;
}

const MAC_TRAFFIC_LIGHT_INSET = 80;

export function PanelLayout( {
	navPanelRef,
	secondaryPanelRef,
	navCollapsed,
	onToggleNav,
}: PanelLayoutProps ) {
	const primaryStartInset = isMac() && navCollapsed ? MAC_TRAFFIC_LIGHT_INSET : undefined;

	return (
		<Group orientation="horizontal" className="flex-1">
			{ /* PanelNavigation */ }
			<Panel
				id="nav"
				panelRef={ navPanelRef }
				defaultSize="260px"
				minSize="200px"
				maxSize="400px"
				collapsible
				collapsedSize={ 0 }
				className="app-no-drag-region"
			>
				<div className="h-full flex flex-col overflow-hidden">
					<Toolbar
						className="app-drag-region"
						end={ <Button icon={ cog } label="Settings" className={ ICON_CHROME } /> }
					/>
					<div className="flex-1 flex items-end p-4">
						<span className="text-xs text-chrome-text-tertiary">PanelNavigation</span>
					</div>
				</div>
			</Panel>

			<Separator className="w-0 relative z-10 app-no-drag-region">
				<div className="absolute inset-y-0 -left-[4px] w-[9px] flex items-center justify-center cursor-col-resize group">
					<div className="w-px h-full bg-gray-200 group-hover:bg-gray-400 transition-colors" />
				</div>
			</Separator>

			{ /* PanelPrimary */ }
			<Panel id="primary" minSize="300px">
				<div className="h-full flex flex-col overflow-hidden bg-frame">
					<Toolbar
						className="app-drag-region"
						startInset={ primaryStartInset }
						start={
							<Button
								icon={ drawerLeft }
								onClick={ onToggleNav }
								label="Toggle navigation"
								className={ ICON_FRAME }
							/>
						}
						middle={ <span className="text-xs text-frame-text-secondary">Project Name</span> }
						end={
							<Button
								icon={ drawerRight }
								onClick={ () => togglePanel( secondaryPanelRef.current ) }
								label="Toggle secondary panel"
								className={ ICON_FRAME }
							/>
						}
					/>
					<div className="flex-1 flex items-center justify-center">
						<span className="text-xs text-frame-text-secondary">PanelPrimary</span>
					</div>
				</div>
			</Panel>

			<Separator className="w-0 relative z-10 app-no-drag-region">
				<div className="absolute inset-y-0 -left-[4px] w-[9px] flex items-center justify-center cursor-col-resize group">
					<div className="w-px h-full bg-gray-200 group-hover:bg-gray-400 transition-colors" />
				</div>
			</Separator>

			{ /* PanelSecondary */ }
			<Panel
				id="secondary"
				panelRef={ secondaryPanelRef }
				defaultSize="400px"
				minSize="300px"
				maxSize="600px"
				collapsible
				collapsedSize={ 0 }
			>
				<div className="h-full flex flex-col overflow-hidden bg-frame">
					<Toolbar
						className="app-drag-region"
						start={
							<div className="flex items-center app-no-drag-region">
								<Button icon={ chevronLeft } label="Back" className={ ICON_FRAME } />
								<Button icon={ chevronRight } label="Forward" className={ ICON_FRAME } />
								<Button icon={ reset } label="Reload" className={ ICON_FRAME } />
							</div>
						}
						middle={
							<span className="text-xs text-frame-text-secondary">http://localhost:8881</span>
						}
						end={ <Button icon={ moreHorizontal } label="More options" className={ ICON_FRAME } /> }
					/>
					<div className="flex-1 flex items-center justify-center">
						<span className="text-xs text-frame-text-secondary">PanelSecondary</span>
					</div>
				</div>
			</Panel>
		</Group>
	);
}
