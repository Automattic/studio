import type { Session, WebContents } from 'electron';
import type { ComponentType, ReactNode } from 'react';

export type StudioExtensionKind = 'built-in' | 'user';
export type StudioExtensionInstallSource = 'bundled' | 'directory' | 'git' | 'manual';
export type StudioExtensionStatus = 'available' | 'installed' | 'missing' | 'unsupported';

export const STUDIO_MAIN_CONTENT_SELECTION_EVENT = 'studio-main-content-selection';

export interface StudioMainContentSelectionEventDetail {
	source: 'site' | 'extension';
	id: string;
}

export interface StudioExtensionManifest {
	id: string;
	name: string;
	description: string;
	version: string;
	kind?: StudioExtensionKind;
	studioExtensionApiVersion?: number;
	publisher?: string;
	repository?: string;
	main?: string;
	renderer?: string;
	allowedNavigationOrigins?: string[];
}

export interface StudioExtensionState {
	installed: boolean;
	enabled: boolean;
	installedPath?: string;
	sourceUrl?: string;
	sourceType?: StudioExtensionInstallSource;
	installedAt?: string;
	updatedAt?: string;
}

export interface StudioExtensionListItem extends StudioExtensionManifest, StudioExtensionState {
	kind: StudioExtensionKind;
	status: StudioExtensionStatus;
	isSupported: boolean;
}

export interface InstalledStudioExtensionPackage {
	manifest: StudioExtensionManifest;
	installedPath: string;
}

export interface StudioExtensionProviderProps {
	children: ReactNode;
}

export interface StudioExtensionSidebarSection {
	id: string;
	component: ComponentType;
}

export interface StudioExtensionMainContentPanel {
	id: string;
	component: ComponentType;
	useIsActive: () => boolean;
}

export interface StudioExtensionSettingsTab {
	name: string;
	title: string;
	component: ComponentType;
}

export interface StudioExtensionAccountSection {
	id: string;
	title: string;
	description: string;
	component: ComponentType;
}

export interface StudioRendererExtension {
	manifest: StudioExtensionManifest;
	providers?: ComponentType< StudioExtensionProviderProps >[];
	sidebarSections?: StudioExtensionSidebarSection[];
	mainContentPanels?: StudioExtensionMainContentPanel[];
	settingsTabs?: StudioExtensionSettingsTab[];
	accountSections?: StudioExtensionAccountSection[];
}

export type StudioExtensionMainHandler = (
	event: Electron.IpcMainInvokeEvent,
	...args: unknown[]
) => unknown;

export interface StudioExtensionNavigationContext {
	webContents: WebContents;
	session: Session;
}

export interface StudioMainExtension {
	manifest: StudioExtensionManifest;
	handlers?: Record< string, StudioExtensionMainHandler >;
	isNavigationAllowed?: (
		context: StudioExtensionNavigationContext,
		navigationUrl: string
	) => boolean;
}

export type StudioExtensionStorageState = Record<
	string,
	Partial< StudioExtensionState > | undefined
>;
