import { Button } from '@wordpress/components';
import {
	chevronLeft,
	chevronRight,
	cog,
	crop,
	drawerLeft,
	navigation,
	rotateRight,
	sidesAxial,
} from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { type RefObject, useEffect, useMemo, useRef } from 'react';
import {
	Group,
	Panel,
	type PanelImperativeHandle,
	Separator,
	useDefaultLayout,
} from 'react-resizable-panels';
import { SiteContentTabs } from 'src/components/site-content-tabs';
import { useAreaScreenshot } from 'src/hooks/use-area-screenshot';
import { useBrowserPanel } from 'src/hooks/use-browser-panel';
import { useElementSelector } from 'src/hooks/use-element-selector';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useRootSelector } from 'src/stores';
import { BrowserCaptureOverlay } from './browser-capture-overlay';
import { BrowserFloatingInput } from './browser-floating-input';
import { BrowserIframeContainer } from './browser-iframe-container';
import { BrowserTabBar } from './browser-tab-bar';
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

function StartStopButton() {
	const { __ } = useI18n();
	const { selectedSite, startServer, stopServer, loadingServer } = useSiteDetails();
	if ( ! selectedSite ) return null;

	const isLoading = loadingServer[ selectedSite.id ];
	const isRunning = selectedSite.running;

	const handleClick = () => {
		if ( isLoading ) return;
		if ( isRunning ) {
			void stopServer( selectedSite.id );
		} else {
			void startServer( selectedSite );
		}
	};

	let label: string;
	if ( isLoading ) {
		label = isRunning ? __( 'Stopping…' ) : __( 'Starting…' );
	} else if ( isRunning ) {
		label = __( 'Stop site' );
	} else {
		label = __( 'Start site' );
	}

	return (
		<Button
			label={ label }
			className={ cx(
				ICON_FRAME,
				isRunning && ! isLoading && '!text-frame-running',
				isLoading && 'animate-pulse'
			) }
			onClick={ handleClick }
			disabled={ isLoading }
		>
			{ isRunning ? (
				<span className="block w-3 h-3 rounded-full bg-current" />
			) : (
				<svg width="12" height="14" viewBox="0 0 8 10" fill="none">
					<path d="M0 0L8 5L0 10V0Z" fill="currentColor" />
				</svg>
			) }
		</Button>
	);
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
	const elementSelector = useElementSelector( {
		getActiveIframe: browser.getActiveIframe,
	} );
	const areaScreenshot = useAreaScreenshot();

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
								label={ `Settings (${ isMac() ? '⌘,' : 'Ctrl+,' })` }
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
				{ ( () => {
					const primaryToolbar = (
						<Toolbar
							className="app-drag-region"
							startInset={ primaryStartInset }
							start={
								<>
									<Button
										icon={ drawerLeft }
										onClick={ onToggleNav }
										label={ `${ navCollapsed ? 'Show' : 'Hide' } navigation (${
											isMac() ? '⌘B' : 'Ctrl+B'
										})` }
										className={ ICON_FRAME }
									/>
									{ pendingNewTask ? (
										<span className="text-xs text-frame-text truncate">New Task</span>
									) : selectedTask ? (
										<span className="text-xs text-frame-text truncate">{ selectedTask.title }</span>
									) : selectedSite ? (
										<span className="text-xs text-frame-text truncate">{ selectedSite.name }</span>
									) : undefined }
								</>
							}
							end={
								<>
									<StartStopButton />
									<Button
										icon={ navigation }
										onClick={ () => togglePanel( secondaryPanelRef.current ) }
										label={ `${
											secondaryPanelRef.current?.isCollapsed() ? 'Show' : 'Hide'
										} browser (${ isMac() ? '⌘⇧B' : 'Ctrl+Shift+B' })` }
										className={ ICON_FRAME }
									/>
								</>
							}
						/>
					);

					return (
						<div className="h-full flex flex-col overflow-hidden bg-frame">
							{ ! isTaskChat && primaryToolbar }
							{ pendingNewTask ? (
								<TaskNewPanel />
							) : selectedTaskId ? (
								<TaskChatPanel
									taskId={ selectedTaskId }
									toolbar={ primaryToolbar }
									elementSelector={ elementSelector }
									areaScreenshot={ areaScreenshot }
								/>
							) : (
								<SiteContentTabs />
							) }
						</div>
					);
				} )() }
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
							<div className="relative flex items-center gap-1 p-2 flex-shrink-0 app-drag-region">
								{ browser.isNavigating && (
									<div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
										<div className="absolute h-full w-[30%] bg-frame-theme animate-[browser-progress_1.5s_ease-in-out_infinite]" />
									</div>
								) }
								<div className="flex items-center app-no-drag-region flex-shrink-0">
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
										icon={ rotateRight }
										label="Reload"
										className="app-no-drag-region text-[#a7aaad] hover:text-white"
										onClick={ browser.handleReload }
									/>
								</div>
								<BrowserTabBar
									tabs={ browser.tabs }
									activeTabId={ browser.activeTabId }
									onSelectTab={ browser.selectTab }
									onCloseTab={ browser.closeTab }
									onNewTab={ browser.addTab }
									canAddTab={ browser.canAddTab }
								/>
								<div className="flex items-center app-no-drag-region flex-shrink-0">
									<Button
										icon={ sidesAxial }
										label="Select element"
										showTooltip
										className={ cx(
											'app-no-drag-region',
											elementSelector.isSelecting
												? 'text-blue-400 bg-blue-500/20'
												: 'text-[#a7aaad] hover:text-white'
										) }
										onClick={ () =>
											elementSelector.isSelecting
												? elementSelector.deactivateSelection()
												: elementSelector.activateSelection()
										}
									/>
									<Button
										icon={ crop }
										label="Capture area"
										showTooltip
										className={ cx(
											'app-no-drag-region',
											areaScreenshot.isCapturing
												? 'text-blue-400 bg-blue-500/20'
												: 'text-[#a7aaad] hover:text-white'
										) }
										onClick={ () =>
											areaScreenshot.isCapturing
												? areaScreenshot.deactivateCapture()
												: areaScreenshot.activateCapture()
										}
									/>
								</div>
							</div>
							<div className="relative flex-1 flex flex-col">
								<BrowserIframeContainer
									tabs={ browser.tabs }
									activeTabId={ browser.activeTabId }
									autoLoginSrc={ browser.autoLoginSrc }
									siteName={ browser.siteName }
									setIframeRef={ browser.setIframeRef }
									onLoad={ browser.handleIframeLoad }
									onBeforeUnload={ browser.handleBeforeUnload }
									onUrlChange={ browser.handleUrlChange }
								/>
								<BrowserCaptureOverlay areaScreenshot={ areaScreenshot } />
								{ ! isTaskChat && selectedSite && (
									<BrowserFloatingInput
										siteId={ selectedSite.id }
										elementSelector={ elementSelector }
										areaScreenshot={ areaScreenshot }
										getActiveIframe={ browser.getActiveIframe }
									/>
								) }
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
