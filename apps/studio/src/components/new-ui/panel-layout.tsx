import { Button, Spinner } from '@wordpress/components';
import { chevronLeft, chevronRight, cog, drawerLeft, drawerRight, reset } from '@wordpress/icons';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import {
	Group,
	Panel,
	type PanelImperativeHandle,
	Separator,
	useDefaultLayout,
} from 'react-resizable-panels';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import { useBrowserPanel } from 'src/hooks/use-browser-panel';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isMac } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import { Sidebar } from './sidebar';
import { TaskChatPanel } from './tasks/task-chat-panel';
import { TaskNewPanel } from './tasks/task-new-panel';
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
	setNavCollapsed: ( collapsed: boolean ) => void;
	onToggleNav: () => void;
}

const MAC_TRAFFIC_LIGHT_INSET = 80;

const PANEL_IDS = [ 'nav', 'primary', 'secondary' ] as const;
const COLLAPSED_KEY = 'panelLayout:collapsed';

function loadCollapsedState(): { nav: boolean; secondary: boolean } {
	try {
		const stored = localStorage.getItem( COLLAPSED_KEY );
		if ( stored ) {
			return JSON.parse( stored );
		}
	} catch {
		// ignore
	}
	return { nav: false, secondary: false };
}

function saveCollapsedState( nav: boolean, secondary: boolean ) {
	localStorage.setItem( COLLAPSED_KEY, JSON.stringify( { nav, secondary } ) );
}

export function PanelLayout( {
	navPanelRef,
	secondaryPanelRef,
	navCollapsed,
	setNavCollapsed,
	onToggleNav,
}: PanelLayoutProps ) {
	const { selectedSite } = useSiteDetails();
	const selectedTaskId = useRootSelector( ( state ) => state.tasks.selectedTaskId );
	const pendingNewTask = useRootSelector( ( state ) => state.tasks.pendingNewTask );
	const selectedTask = useRootSelector( ( state ) =>
		state.tasks.tasks.find( ( t ) => t.id === state.tasks.selectedTaskId )
	);
	const isTaskChat = ! pendingNewTask && !! selectedTaskId;
	const primaryStartInset = isMac() && navCollapsed ? MAC_TRAFFIC_LIGHT_INSET : undefined;
	const browser = useBrowserPanel();

	const initialCollapsed = useRef( loadCollapsedState() );

	const { defaultLayout: savedLayout, onLayoutChanged: saveLayout } = useDefaultLayout( {
		id: 'studio-panels',
		panelIds: [ ...PANEL_IDS ],
	} );

	// Apply collapsed state to the default layout so panels start collapsed
	const defaultLayout = useMemo( () => {
		if ( ! savedLayout ) {
			return undefined;
		}
		const layout = { ...savedLayout };
		if ( initialCollapsed.current.nav ) {
			layout.nav = 0;
		}
		if ( initialCollapsed.current.secondary ) {
			layout.secondary = 0;
		}
		return layout;
	}, [ savedLayout ] );

	const handleLayoutChanged = ( layout: Record< string, number > ) => {
		saveLayout( layout );
		const isNavCollapsed = layout.nav === 0;
		saveCollapsedState( isNavCollapsed, layout.secondary === 0 );
		// Sync navCollapsed state when panels collapse/expand via drag
		if ( isNavCollapsed !== navCollapsed ) {
			setNavCollapsed( isNavCollapsed );
		}
	};

	// Sync navCollapsed state on mount if nav starts collapsed
	useEffect( () => {
		if ( initialCollapsed.current.nav ) {
			setNavCollapsed( true );
		}
		// Only run on mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [] );

	return (
		<Group
			orientation="horizontal"
			className="flex-1"
			defaultLayout={ defaultLayout }
			onLayoutChanged={ handleLayoutChanged }
		>
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
						end={
							<Button
								icon={ cog }
								label="Settings"
								className={ ICON_CHROME }
								onClick={ () => getIpcApi().openSettingsWindow() }
							/>
						}
					/>
					<Sidebar className="flex-1" />
				</div>
			</Panel>

			<Separator className="w-0 relative z-10 app-no-drag-region">
				<div className="absolute inset-y-0 -left-[4px] w-[9px] flex items-center justify-center cursor-col-resize group">
					<div className="w-px h-full bg-chrome-border group-hover:bg-chrome-text-tertiary transition-colors" />
				</div>
			</Separator>

			{ /* PanelPrimary */ }
			<Panel id="primary" minSize="300px">
				<div
					className={ `h-full flex flex-col overflow-hidden bg-frame ${
						isTaskChat ? 'relative' : ''
					}` }
				>
					<Toolbar
						className={ `app-drag-region ${
							isTaskChat ? 'absolute top-0 left-0 right-0 z-20 task-toolbar-blur' : ''
						}` }
						startInset={ primaryStartInset }
						start={
							<Button
								icon={ drawerLeft }
								onClick={ onToggleNav }
								label="Toggle navigation"
								className={ ICON_FRAME }
							/>
						}
						middle={
							pendingNewTask ? (
								<span className="text-xs text-frame-text">New Task</span>
							) : selectedTask ? (
								<span className="text-xs text-frame-text">{ selectedTask.title }</span>
							) : selectedSite ? (
								<span className="text-xs text-frame-text">{ selectedSite.name }</span>
							) : undefined
						}
						end={
							<Button
								icon={ drawerRight }
								onClick={ () => togglePanel( secondaryPanelRef.current ) }
								label="Toggle secondary panel"
								className={ ICON_FRAME }
							/>
						}
					/>
					{ pendingNewTask ? (
						<TaskNewPanel />
					) : selectedTaskId ? (
						<TaskChatPanel taskId={ selectedTaskId } />
					) : (
						<SiteContentTabs />
					) }
				</div>
			</Panel>

			<Separator className="w-0 relative z-10 app-no-drag-region">
				<div className="absolute inset-y-0 -left-[4px] w-[9px] flex items-center justify-center cursor-col-resize group">
					<div className="w-px h-full bg-chrome-border group-hover:bg-chrome-text-tertiary transition-colors" />
				</div>
			</Separator>

			{ /* PanelSecondary */ }
			<Panel
				id="secondary"
				panelRef={ secondaryPanelRef }
				defaultSize="400px"
				minSize="300px"
				collapsible
				collapsedSize={ 0 }
			>
				<div className="h-full flex flex-col overflow-hidden bg-[#1d2327]">
					{ browser.autoLoginSrc ? (
						<>
							{ ! browser.isInitialLoad && (
								<div className="relative flex items-center gap-1 p-2 flex-shrink-0">
									{ browser.isNavigating && (
										<div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
											<div className="absolute h-full w-[30%] bg-frame-theme animate-[browser-progress_1.5s_ease-in-out_infinite]" />
										</div>
									) }
									<div className="flex items-center app-no-drag-region">
										<Button
											icon={ chevronLeft }
											label="Back"
											className="app-no-drag-region text-[#a7aaad] hover:text-white"
											onClick={ browser.handleBack }
										/>
										<Button
											icon={ chevronRight }
											label="Forward"
											className="app-no-drag-region text-[#a7aaad] hover:text-white"
											onClick={ browser.handleForward }
										/>
										<Button
											icon={ reset }
											label="Reload"
											className="app-no-drag-region text-[#a7aaad] hover:text-white"
											onClick={ browser.handleReload }
										/>
									</div>
									<input
										type="text"
										value={ browser.displayUrl }
										onChange={ ( e ) => browser.setDisplayUrl( e.target.value ) }
										onKeyDown={ ( e ) => {
											if ( e.key === 'Enter' ) {
												browser.handleNavigate( browser.displayUrl );
											}
										} }
										className="flex-1 min-w-0 text-xs text-[#a7aaad] bg-transparent outline-none app-no-drag-region"
										aria-label="URL"
									/>
								</div>
							) }
							<div className="flex-1 overflow-hidden relative">
								{ browser.isInitialLoad && (
									<div className="absolute inset-0 flex items-center justify-center z-10">
										<Spinner className="!mt-0 [&>circle]:stroke-[#a7aaad]" />
									</div>
								) }
								<iframe
									ref={ browser.iframeRef }
									src={ browser.autoLoginSrc }
									onLoad={ browser.handleIframeLoad }
									className={ `w-full h-full border-0 transition-opacity duration-150 ${
										browser.isInitialLoad ? 'opacity-0' : 'opacity-100'
									}` }
									title={ browser.siteName || 'Site preview' }
								/>
							</div>
						</>
					) : (
						<div className="flex-1 flex items-center justify-center">
							<span className="text-xs text-[#a7aaad]">Start the site to preview it</span>
						</div>
					) }
				</div>
			</Panel>
		</Group>
	);
}
