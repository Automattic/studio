import type { ActiveAgentRun, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { AiModelId } from '@studio/common/ai/models';
import type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';
import type { SiteEvent } from '@studio/common/lib/cli-events';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';
import type { SupportedLocale } from '@studio/common/lib/locale';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { PullSiteProgress, SyncSite } from '@studio/common/types/sync';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export type { ActiveAgentRun, AgentRunEvent } from '@studio/common/ai/agent-events';
export type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
export type { StudioChatImage, StudioChatImageAttachment } from '@studio/common/ai/chat-images';
export type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';
export type { SessionEntry } from '@earendil-works/pi-coding-agent';
export type {
	StudioCustomEntry,
	StudioCustomEntryType,
	StudioCustomEntryDataMap,
	StudioSiteSelectedData,
	StudioToolProgressData,
	StudioAgentQuestionData,
	StudioTurnClosedData,
	StudioSessionContextData,
	StudioUserPromptData,
} from '@studio/common/ai/sessions/entry-types';
export type { AiModelId } from '@studio/common/ai/models';
export type { Snapshot } from '@studio/common/types/snapshot';
export type { PullSiteProgress, SyncSite } from '@studio/common/types/sync';
export type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
export type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
export type { SupportedLocale } from '@studio/common/lib/locale';
export type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

export type InstalledApps = Record< SupportedEditor | SupportedTerminal, boolean >;

export interface AiSessionSitePlacement {
	kind: 'site';
	siteId: string;
	sitePath: string;
	siteName: string;
}

export interface AiSessionPlacementUpdatedEvent {
	sessionId: string;
	placement: AiSessionSitePlacement;
}

export interface SiteDetails {
	id: string;
	name: string;
	path: string;
	port: number;
	running: boolean;
	url?: string;
	customDomain?: string;
	enableHttps?: boolean;
	phpVersion: string;
	isWpAutoUpdating?: boolean;
	adminUsername?: string;
	// Base64-encoded. Use encodePassword/decodePassword from
	// @studio/common/lib/passwords when reading or writing.
	adminPassword?: string;
	adminEmail?: string;
	enableXdebug?: boolean;
	enableDebugLog?: boolean;
	enableDebugDisplay?: boolean;
	sortOrder?: number;
	// True for sites that were running when the app quit with the
	// "Stop, restart on next launch" behavior; the renderer starts them on boot.
	autoStart?: boolean;
	themeDetails?: {
		name: string;
		path: string;
		slug: string;
		isBlockTheme: boolean;
		// Only supplied by the desktop (IPC) connector.
		supportsWidgets?: boolean;
		supportsMenus?: boolean;
	};
	siteIcon?: string | null;
}

export interface LocalMediaFile {
	name: string;
	mimeType: string;
	data: ArrayBuffer;
}

export interface AuthUser {
	id: number;
	email: string;
	displayName: string;
}

// What native affordances the host environment offers, so the UI can choose
// between a native flow and a browser-friendly fallback (instead of branching on
// "am I in Electron"). The desktop app has them all; the browser (`studio ui` /
// hosted) does not — except `openInOS`, which the local server can do because it
// runs on the user's own machine.
export interface ConnectorCapabilities {
	// A native OS folder picker is available (`selectSiteFolder`). When false,
	// the UI offers an editable path field instead.
	nativeFolderPicker: boolean;
	// A native "Save As" dialog is available, so exports write to a chosen path.
	// When false, exports are delivered to the browser as a download.
	nativeSaveDialog: boolean;
	// The host can open paths in OS apps (file manager, editor, terminal) and
	// detect installed apps. True on the desktop and the local server (both on
	// the user's machine); false when hosted remotely.
	openInOS: boolean;
	// The preview can host the annotation inspector (script injection + a bridge
	// into the previewed page). Only the desktop's <webview> supports this; in a
	// browser the preview is a cross-origin <iframe> that can't be injected, so
	// the Annotate control is hidden.
	annotatePreview: boolean;
	// `readLocalMediaFile` can read media files from the host's disk (used to
	// render local screenshot artifacts inline). Only the desktop IPC connector
	// supports it; the browser connectors reject local file reads.
	readLocalMedia: boolean;
	// The host can read/write the user's global Studio Code instructions file
	// (~/.studio/knowledge/instructions.md). False when hosted remotely, which
	// hides the Studio Code settings tab.
	agentInstructions: boolean;
	// The host can switch this window back to the classic Studio UI
	// (`disableAgenticUi`). Only the desktop app ships the classic renderer;
	// in a browser there is nothing to switch to.
	switchToClassicUi: boolean;
}

export interface Connector {
	/**
	 * Optional hook for connector-specific setup that must run after the
	 * connector is constructed but before the UI renders.
	 */
	init?(): Promise< void >;

	// What native affordances this host offers (see ConnectorCapabilities).
	capabilities: ConnectorCapabilities;

	// Auth
	requiresAuth: boolean;
	agenticRequiresAuth: boolean;
	isAuthenticated(): Promise< boolean >;
	getAuthUser(): Promise< AuthUser | null >;
	authenticate( signup?: boolean ): Promise< void >;
	logout(): Promise< void >;
	onAuthStateChanged?( listener: () => void ): () => void;

	// Onboarding — whether the user has been through (or skipped) the
	// first-run welcome screen.
	getOnboardingCompleted(): Promise< boolean >;
	setOnboardingCompleted( completed: boolean ): Promise< void >;

	// Sites
	getSites(): Promise< SiteDetails[] >;
	createSite( params: CreateSiteParams ): Promise< SiteDetails >;
	// Deletes a site from Studio. When `deleteFiles` is true the site folder is
	// also removed from disk; otherwise the files stay and only the Studio entry
	// is dropped.
	deleteSite( id: string, deleteFiles?: boolean ): Promise< void >;
	// Duplicates an existing site (copies its files and admin credentials, then
	// registers it as a new site). The connector picks a numbered name and a new
	// site id internally so callers stay simple.
	copySite( sourceSiteId: string ): Promise< SiteDetails >;
	startSite( id: string ): Promise< void >;
	stopSite( id: string ): Promise< void >;
	// Persists edits from the site-settings screen via the CLI-backed main
	// process handler. `wpVersion` is only forwarded when the user explicitly
	// picked a pinned version — undefined means "keep auto-updating".
	updateSite( site: SiteDetails, wpVersion?: string ): Promise< void >;
	// Persists the sidebar's manual site order (the same per-site `sortOrder`
	// the legacy desktop sidebar uses).
	updateSitesSortOrder( updates: { siteId: string; sortOrder: number }[] ): Promise< void >;
	// Refreshes the cached WordPress Site Icon path after a site-level icon
	// change. The renderer receives image bytes through getSites().
	refreshSiteIcon( siteId: string ): Promise< void >;

	// Exports a site as a full backup archive (files + database). Prompts the
	// user for a destination via a save-as dialog; resolves with the chosen
	// path on success, or `null` if the user cancelled the dialog.
	exportFullSite( siteId: string ): Promise< string | null >;
	// Exports only the site database as a .sql dump. Same dialog/cancel
	// semantics as `exportFullSite`.
	exportDatabase( siteId: string ): Promise< string | null >;

	// Site-creation helpers — surface the same main-process capabilities the
	// desktop app's add-site flow relies on (folder pickers and path validation).
	generateProposedSitePath( siteName: string ): Promise< ProposedSitePath >;
	generateProposedSiteName( usedSites: SiteDetails[] ): Promise< string >;
	generateNumberedSiteName( baseName: string, usedSites: SiteDetails[] ): Promise< string >;
	selectSiteFolder( defaultPath: string ): Promise< SelectedSiteFolder | null >;
	comparePaths( path1: string, path2: string ): Promise< boolean >;

	getWordPressVersions(): Promise< WordPressVersion[] >;
	// Reads the WordPress version installed at the site's path. Resolves to
	// '-' when it can't be determined (missing files, site not found).
	getWpVersion( siteId: string ): Promise< string >;

	// Resolves the absolute filesystem path of a File handle picked or dropped
	// in the renderer. Returns an empty string when the underlying file lacks
	// a real path (synthetic blobs, non-Electron environments).
	getFilePath( file: File ): Promise< string >;
	readLocalMediaFile( path: string ): Promise< LocalMediaFile >;

	// Uploads and extracts a Blueprint ZIP bundle to a temp directory and returns the
	// parsed `blueprint.json`. The caller is responsible for calling
	// `cleanupBlueprintTempDir` if the extraction succeeds but the upload
	// flow never reaches `createSite` — otherwise `createSite` cleans the
	// temp directory automatically when it uses the extracted blueprint.
	extractBlueprintBundle( file: File ): Promise< ExtractedBlueprintBundle >;
	cleanupBlueprintTempDir( tempDir: string ): Promise< void >;
	readBlueprintFile( filePath: string ): Promise< BlueprintV1Declaration >;

	// Imports a backup into an already-created site and starts the usable site.
	// `backupPath` comes from `getFilePath` for the current submission.
	importSiteFromBackup(
		siteId: string,
		backupPath: string,
		onProgress?: ( event: ImportEventTuple ) => void
	): Promise< void >;

	// Preview snapshots (WordPress.com hosted previews of local sites)
	getSnapshots(): Promise< Snapshot[] >;
	// WordPress.com preview-site quota for the signed-in account. Resolves
	// `null` when usage can't be determined (signed out, or the host has no
	// usage source) so callers can fall back to counting snapshots.
	getSnapshotUsage(): Promise< SnapshotUsage | null >;
	// Studio Code AI usage quota for the signed-in account. Resolves `null`
	// when the quota can't be determined (signed out, or the host has no
	// quota source) so callers can fall back to static copy.
	getStudioAssistantQuota(): Promise< StudioAssistantQuota | null >;
	deleteAllSnapshots(): Promise< void >;
	// Asks the user to confirm deleting every preview site on their account.
	// Resolves `true` only when they explicitly confirm.
	confirmDeleteAllPreviewSites(): Promise< boolean >;
	// Creates a new preview snapshot for the given site, or refreshes the
	// existing one when `existingHostname` is supplied. Resolves with the
	// final preview URL when the CLI command completes.
	publishPreviewSite( siteId: string, existingHostname?: string ): Promise< { url: string } >;

	// Connected WordPress.com live sites for a local site, or every persisted
	// connection for the current user when no local site is supplied.
	getConnectedWpcomSites( localSiteId?: string ): Promise< SyncSite[] >;
	// All WordPress.com sites the authenticated user can sync with, regardless
	// of which (if any) local site they're already connected to. The publish
	// picker filters this list to sites that aren't connected anywhere yet.
	fetchSyncableWpcomSites(): Promise< SyncSite[] >;
	// Persists a new local↔live connection so the dropdown picks it up via
	// `getConnectedWpcomSites`. Safe to call with the minimal `SyncSite` we
	// receive from a sync-connect-site deep link — later fetches backfill the
	// display name and URL.
	connectWpcomSite( localSiteId: string, site: SyncSite ): Promise< void >;
	// Removes a local↔live connection. The remote WordPress.com site is
	// unaffected — only the Studio-side mapping is dropped, so Pull/Push
	// are no longer available until the user reconnects.
	disconnectWpcomSite( localSiteId: string, remoteSiteId: number ): Promise< void >;
	// Pushes the local site to a previously connected WordPress.com site.
	// Replaces the remote contents with the local database and wp-content.
	pushSiteToLive( siteId: string, remoteSiteId: number ): Promise< void >;
	// Pulls the connected WordPress.com site's database + wp-content back
	// into the local Studio site. Stops the local server while the backup
	// imports and restarts it on completion.
	pullSiteFromLive(
		siteId: string,
		remoteSiteId: number,
		onProgress?: ( progress: PullSiteProgress ) => void
	): Promise< void >;
	// URL to open in the browser when the user wants to publish a site that
	// isn't connected to WordPress.com yet (checkout + deep-link back to the
	// desktop app). Returns `undefined` when the connector can't provide one.
	getPublishCheckoutUrl( site: SiteDetails ): string | undefined;
	// Fires when a WordPress.com "Connect to Studio" flow deep-links back
	// into the app after the user picks a site on wordpress.com.
	onSyncConnectSite(
		listener: ( event: {
			remoteSiteId: number;
			studioSiteId: string;
			autoOpenPush?: boolean;
		} ) => void
	): () => void;
	// Optional: ask the backend to watch for a freshly-created WordPress.com site
	// (the "Create new" checkout) and report it via `onSyncConnectSite`. Used by
	// surfaces that can't receive the desktop's wp-studio:// deep link — the local
	// web server polls the account's sites instead.
	watchForPublishedSite?( siteId: string ): Promise< void >;

	// AI sessions (shared with the CLI — stored as JSONL on disk)
	getSessions(): Promise< AiSessionSummary[] >;
	getSession( sessionId: string ): Promise< LoadedAiSession >;
	deleteSession( sessionId: string ): Promise< void >;
	updateSessionMetadata(
		sessionId: string,
		patch: Pick< AiSessionSummary, 'archived' >
	): Promise< AiSessionSummary >;

	// Create an empty session file so it appears immediately. When `siteId`
	// is omitted, the session is a user chat with no owner site.
	createSession( siteId?: string ): Promise< AiSessionSummary >;

	// Continue an existing session by sending a new prompt. Returns a `runId`
	// that identifies the in-flight agent run; live events for that run stream
	// through `onAgentEvent`.
	continueSession(
		sessionId: string,
		prompt: string,
		options?: {
			displayMessage?: string;
			images?: StudioChatImage[];
			files?: StudioChatFileAttachment[];
		}
	): Promise< { runId: string } >;
	getActiveAgentRuns(): Promise< ActiveAgentRun[] >;
	// Persist a UI-driven model override for the session. The CLI picks this up
	// on the next turn; the change survives reloads because it's written to the
	// session JSONL.
	setSessionModel( sessionId: string, model: AiModelId ): Promise< void >;
	interruptAgentRun( runId: string ): Promise< void >;
	answerAgentQuestion( runId: string, answers: Record< string, string > ): Promise< void >;
	onAgentEvent( listener: ( event: AgentRunEvent ) => void ): () => void;
	onSessionPlacementUpdated(
		listener: ( event: AiSessionPlacementUpdatedEvent ) => void
	): () => void;

	// Flip the session between acting on its owner site's local runtime vs.
	// its linked WordPress.com live site. The owner site itself never changes.
	setSessionEnvironment(
		sessionId: string,
		environment: 'local' | 'live'
	): Promise< { environment: 'local' | 'live'; url?: string; wpcomSiteId?: number } >;

	// User preferences — editor, terminal, color scheme, locale. Fanned out to
	// the granular main-process handlers inside the connector so the UI has a
	// single query + mutation to work with.
	getUserPreferences(): Promise< UserPreferences >;
	setUserPreferences( partial: Partial< WritableUserPreferences > ): Promise< void >;

	// Opens a native folder picker for the default-site-directory preference.
	// Resolves with the chosen path, or `null` when the user cancels (or the
	// host has no native picker — see capabilities.nativeFolderPicker).
	selectDefaultSiteDirectory( defaultPath: string ): Promise< string | null >;

	// The user's global Studio Code instructions, a markdown file injected into
	// every agent session. Gated by `capabilities.agentInstructions`.
	getAgentInstructions(): Promise< string >;
	saveAgentInstructions( content: string ): Promise< void >;

	// Apps detected on disk (editors + terminals). Options in the preferences
	// form are filtered against this so users can't pick something that isn't
	// installed.
	getInstalledApps(): Promise< InstalledApps >;

	// Host environment facts used to gate native-only UI (e.g. the Studio CLI
	// toggle is hidden in Windows Store builds). Browser connectors report
	// platform 'browser'.
	getAppGlobals(): Promise< AppGlobals >;

	// Open the given site's folder in the system file manager, preferred
	// editor, or preferred terminal. When no editor/terminal preference is
	// set these reject — callers are expected to route the user to Settings.
	openSiteFolder( siteId: string ): Promise< void >;
	openSiteInEditor( siteId: string ): Promise< void >;
	openSiteInTerminal( siteId: string ): Promise< void >;

	// Analytics — record a Tracks event. The connector attaches the surface
	// params (channel/ui_version); see `docs/design-docs/analytics-tracks.md`.
	trackEvent( eventName: TracksEventName, props?: TracksProps ): Promise< void >;

	// External links
	openExternalUrl( url: string ): Promise< void >;

	// Wapuu World easter-egg high score. Returns undefined when no score has
	// been recorded yet; saving keeps only the highest score seen.
	getWapuuScore(): Promise< number | undefined >;
	saveWapuuScore( score: number ): Promise< void >;

	popupAppMenu( position: { x: number; y: number } ): Promise< void >;

	// WordPress agent skills applied to all existing and future sites.
	getWordPressSkillsStatusAllSites(): Promise< SkillStatus[] >;
	installWordPressSkillToAllSites( skillId: string ): Promise< void >;
	removeWordPressSkillFromAllSites( skillId: string ): Promise< void >;

	// Whether the UI should render a button that opens the app menu via
	// `popupAppMenu`. True only in the Windows/Linux desktop app, which has no
	// native menu bar; macOS has the native application menu and the browser
	// (`studio ui` / hosted) has no app menu at all.
	showsAppMenuButton: boolean;

	// Clipboard — routed to the host so it works where the renderer's
	// `navigator.clipboard` is unavailable (e.g. Electron permission denial).
	copyText( text: string ): Promise< void >;

	// Site preview annotation, driven from the host's native context menu.
	// Absent in the browser builds, which have no such menu to hang it off.
	// The host needs to know whether the inspector is currently attached so it
	// can leave the item out rather than offer one that does nothing.
	setPreviewAnnotationReady?( ready: boolean ): void;
	onPreviewAnnotateElement?( listener: () => void ): () => void;

	openSiteUrl(
		siteId: string,
		relativeUrl?: string,
		options?: { autoLogin?: boolean }
	): Promise< void >;

	// Whether this host overlays macOS window controls ("traffic lights") on the
	// top-left of the content, so the UI must reserve space for them. True only
	// in the macOS desktop app; false on other platforms and in the browser
	// (`studio ui` / hosted), where there are no traffic lights. Combined with
	// `isFullscreen` — macOS hides the traffic lights in fullscreen — to decide
	// when to actually leave the gap (see `useTrafficLightSpace`).
	reservesTrafficLightSpace: boolean;

	// Window state (macOS fullscreen hides traffic lights, so the UI needs
	// to reclaim the space we normally leave for them).
	isFullscreen(): Promise< boolean >;
	onFullscreenChange( listener: ( fullscreen: boolean ) => void ): () => void;

	// Fires whenever a site is created, updated, started, stopped, or deleted.
	// Consumers typically invalidate cached site data in response.
	onSiteEvent( listener: ( event: SiteEvent ) => void ): () => void;

	// Fires when the user activates "View > Toggle Site Preview" (⌘⇧B) in the
	// application menu.
	onToggleSitePreview( listener: () => void ): () => void;

	// Fires when the user activates the sidebar toggle shortcut or menu command.
	onToggleSidebar( listener: () => void ): () => void;

	// Fires when the user activates "File > Add Site…" (or its keyboard
	// shortcut) in the application menu.
	onAddSite( listener: () => void ): () => void;
	onAddSiteWithBlueprint( listener: ( payload: { blueprintPath: string } ) => void ): () => void;

	// Fires when the user activates "Settings…" (or its keyboard shortcut) in
	// the application menu.
	onOpenSettings( listener: () => void ): () => void;

	// Switches back to the legacy (classic) Studio UI.
	disableAgenticUi(): Promise< void >;

	// Auto-updater status.
	getAppUpdateStatus(): Promise< AppUpdateStatus >;
	installAppUpdate(): Promise< void >;
	onAppUpdateStatusChanged( listener: ( status: AppUpdateStatus ) => void ): () => void;
}

export interface AppUpdateStatus {
	readyToInstall: boolean;
	version: string | null;
}

export interface SnapshotUsage {
	siteCount: number;
	siteLimit: number;
	siteCreationBlocked: boolean;
}

export interface SkillStatus {
	id: string;
	displayName: string;
	description: string;
	installed: boolean;
}

export type ColorScheme = 'system' | 'light' | 'dark';
export type QuitSitesBehavior = 'stop' | 'stop-and-auto-start' | 'leave-running';

export interface UserPreferences {
	editor: SupportedEditor | null;
	terminal: SupportedTerminal | null;
	colorScheme: ColorScheme;
	quitSitesBehavior?: QuitSitesBehavior;
	locale: string | undefined;
	// Whether the user shares anonymous usage statistics (Tracks). Default true.
	// See `docs/design-docs/analytics-tracks.md`.
	analyticsEnabled: boolean;
	defaultSiteDirectory: string;
	studioCliInstalled: boolean;
	// True when the `studio` command on PATH is a standalone (curl) install the
	// app never installs over or uninstalls — the settings toggle disables
	// itself in that case.
	studioCliExternallyManaged: boolean;
	// Whether chat/agent features are offered at all. Unrelated to which
	// renderer is running — switching to the classic UI is `disableAgenticUi`.
	agenticFeaturesEnabled: boolean;
}

export interface AppGlobals {
	platform: string;
	isWindowsStore: boolean;
}

// Subset of UserPreferences that callers can actually mutate. `locale` is
// typed as `SupportedLocale` on the write side because only locales we ship
// translations for can be persisted.
export type WritableUserPreferences = Omit<
	UserPreferences,
	'locale' | 'studioCliExternallyManaged'
> & {
	locale: SupportedLocale;
};

export interface CreateSiteParams {
	name: string;
	path: string;
	phpVersion?: SupportedPHPVersion;
	wpVersion?: string;
	customDomain?: string;
	enableHttps?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	// Creates the local shell without starting its server. Connect onboarding
	// uses this so remote content lands before the first local start.
	skipStart?: boolean;
	// Optional blueprint payload. `filePath` points at the extracted
	// `blueprint.json` inside a ZIP bundle so the CLI can resolve relative assets.
	blueprint?: {
		blueprint: BlueprintV1Declaration;
		filePath?: string;
	};
}

export interface ExtractedBlueprintBundle {
	blueprintJson: BlueprintV1Declaration;
	blueprintJsonPath: string;
	tempDir: string;
}

export interface ProposedSitePath {
	path: string;
	isEmpty: boolean;
	isWordPress: boolean;
	isNameTooLong?: boolean;
}

export interface SelectedSiteFolder {
	path: string;
	name: string;
	isEmpty: boolean;
	isWordPress: boolean;
}
