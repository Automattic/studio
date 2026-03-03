/**
 * Addon API types for use within the Studio app.
 *
 * This is the Studio-internal contract. External addon authors should use
 * the `@studio/addon-api` package in `tools/addon-api/` which mirrors these types.
 * They are kept in sync manually.
 */

import type { ComponentType, ReactNode } from 'react';

// ─── Manifest ────────────────────────────────────────────────────────────────

export interface AddonManifest {
	/** Kebab-case unique id, e.g. "studio-vip-environment" */
	id: string;
	name: string;
	version: string;
	author: string;
	description: string;
	/** Semver range of compatible Studio versions */
	studioVersionRange: string;
	permissions: AddonPermission[];
}

export type AddonPermission =
	| `ipc:${ string }`
	| 'ui:content-tabs'
	| 'ui:context-menu'
	| 'ui:header-actions'
	| 'ui:sidebar-content'
	| 'ui:settings-panel'
	| 'ui:top-bar'
	| 'ui:main-content'
	| 'ui:add-site-flow'
	| 'ui:app-providers'
	| 'cli:commands'
	| 'storage:addon-data';

// ─── Lifecycle Context ────────────────────────────────────────────────────────

export interface AddonStorageApi< T = unknown > {
	read(): Promise< T | undefined >;
	write( data: T ): Promise< void >;
}

export interface AddonInitContext {
	storage: AddonStorageApi;
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

export interface AddonIpcRegistration {
	/** IPC channel name, e.g. "vip:getEnvironments" */
	channelName: string;
	/**
	 * Handler function. Will be called with (event, ...args).
	 * Must return a Promise (same contract as core IPC handlers).
	 */
	handler: ( event: unknown, ...args: unknown[] ) => Promise< unknown >;
	/** If true, registered via ipcMain.on (fire-and-forget). Default: false (uses ipcMain.handle) */
	isVoid?: boolean;
}

// ─── Redux ────────────────────────────────────────────────────────────────────

export interface AddonReduxRegistration {
	/** Key to use in the root reducer */
	key: string;
	reducer: ( state: unknown, action: unknown ) => unknown;
	middleware?: unknown[];
}

// ─── UI Context ───────────────────────────────────────────────────────────────

export interface MainContentContext {
	selectedSiteId: string | null;
	/** The addon ID that currently has explicit focus in the main content area, or null. */
	focusedAddonId: string | null;
	/** Call from a sidebar item click to give this addon focus. Pass null to clear. */
	setFocusedAddonId: ( id: string | null ) => void;
}

// ─── UI Slots ─────────────────────────────────────────────────────────────────

export interface AddonContentTab {
	/** Must be unique across all addons and core tabs */
	name: string;
	title: string;
	/** Higher order = later in the tab list. Core tabs use 1–6. */
	order: number;
	/** Optional CSS class for the tab button */
	className?: string;
	/** The tab panel content component. Receives selectedSite as a prop. */
	component: ComponentType< { selectedSite: SiteDetails } >;
}

export interface AddonContextMenuItem {
	/** Unique id for this item */
	id: string;
	label: string | ( ( context: ContextMenuContext ) => string );
	/** If false or returns false, item is shown as disabled */
	enabled?: boolean | ( ( context: ContextMenuContext ) => boolean );
	/** If true, a separator is prepended before this item */
	separator?: boolean;
	/** Action string sent back to renderer via 'site-context-menu-action' IPC event */
	action: string;
}

export interface ContextMenuContext {
	siteId: string;
	isRunning: boolean;
	isLoading: boolean;
	isAddingSite: boolean;
}

export interface AddonHeaderAction {
	id: string;
	component: ComponentType< { selectedSite: SiteDetails } >;
}

export interface AddonSettingsPanel {
	/** Tab name shown in Settings modal */
	name: string;
	title: string;
	component: ComponentType;
}

export interface AddonTopBarItem {
	id: string;
	component: ComponentType;
}

// ─── Add-Site Flow ────────────────────────────────────────────────────────────

export interface AddonAddSiteFlowProps {
	/** Call when the addon has successfully created the site. */
	onSubmit: () => void;
	/** Call whenever form validity changes; controls the stepper "Add site" button. */
	onValidityChange: ( isValid: boolean ) => void;
	/**
	 * Optional ref. The addon component should set `submitRef.current` to its submit
	 * function so the stepper footer's "Add site" button can trigger it.
	 */
	submitRef?: React.RefObject< ( () => void ) | null >;
}

export interface AddonAddSiteFlow {
	/** Machine-readable type, must be unique across addons. e.g. "vip" */
	type: string;
	/** Button label shown on the options screen */
	label: string;
	description: string;
	icon: ReactNode;
	/** Full-screen form/wizard rendered at the "/addon-{type}" Navigator route */
	component: ComponentType< AddonAddSiteFlowProps >;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

export interface AddonCliRegistration {
	register: ( argv: unknown ) => void;
}

// ─── Main AddonDefinition ─────────────────────────────────────────────────────

export interface AddonDefinition {
	manifest: AddonManifest;

	// Main process
	/** IPC handlers registered on ipcMain at boot */
	ipcHandlers?: AddonIpcRegistration[];
	/** Methods merged into window.ipcApi via contextBridge */
	preloadApi?: Record< string, ( ...args: unknown[] ) => unknown >;

	// Renderer: state
	/** Redux slices + middleware merged into the root store */
	redux?: AddonReduxRegistration[];
	/** Context providers wrapped around the app root (app.tsx) */
	appProviders?: ComponentType< { children: ReactNode } >[];

	// Renderer: navigation / layout
	/**
	 * Participates in main content routing. Called before core routing logic.
	 * Return a ReactNode to take over the main content area, or null to defer.
	 */
	mainContentRenderer?: ( context: MainContentContext ) => ReactNode | null;

	// Renderer: UI surfaces
	/** Per-site tabs appended after core tabs */
	contentTabs?: AddonContentTab[];
	/** Site right-click menu items */
	contextMenuItems?: AddonContextMenuItem[];
	/** Site header action buttons */
	headerActions?: AddonHeaderAction[];
	/**
	 * Content injected into the scrollable sites area of the sidebar.
	 * Rendered after SiteMenu, within the same scrollable container.
	 */
	sidebarContent?: ComponentType;
	/** Panels added to the User Settings modal */
	settingsPanels?: AddonSettingsPanel[];
	/** App top bar buttons/icons */
	topBarItems?: AddonTopBarItem[];

	// Renderer: add-site flow
	/** Registers a new option in the "Add Site" modal stepper. */
	addSiteFlows?: AddonAddSiteFlow[];

	// CLI
	cliCommands?: AddonCliRegistration[];

	// Lifecycle
	onInitialize?: ( ctx: AddonInitContext ) => Promise< void >;
	onTeardown?: () => Promise< void >;
}
