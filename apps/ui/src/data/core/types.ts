import type { ActiveAgentRun, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { AiModelId } from '@studio/common/ai/models';
import type { AiResponseLength } from '@studio/common/ai/response-length';
import type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';
import type {
	PermissionDecision,
	ToolPermissionOverrides,
} from '@studio/common/ai/tool-permissions';
import type { ActivitySoundPreferences } from '@studio/common/lib/activity-sounds';
import type { SiteEvent } from '@studio/common/lib/cli-events';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';
import type { SupportedLocale } from '@studio/common/lib/locale';
import type {
	TracksEventName,
	TracksProps,
	TracksSiteCreateFlowType,
} from '@studio/common/lib/record-tracks-event';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { SiteRuntime } from '@studio/common/lib/site-runtime';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { Snapshot } from '@studio/common/types/snapshot';
import type {
	ImportResponse,
	PullSiteProgress,
	SyncOption,
	SyncSite,
} from '@studio/common/types/sync';
import type { SiteRestRequest, SiteRestResponse } from '@studio/common/types/wordpress-rest';
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
	StudioAgentQuestionData,
	StudioTurnClosedData,
	StudioSessionContextData,
	StudioUserPromptData,
	StudioPermissionRequestData,
	StudioPermissionResponseData,
} from '@studio/common/ai/sessions/entry-types';
export type {
	PermissionDecision,
	PermissionRequestData,
	ToolPermissionOverrides,
} from '@studio/common/ai/tool-permissions';
export type { AiModelId } from '@studio/common/ai/models';
export type { Snapshot } from '@studio/common/types/snapshot';
export type { PullSiteProgress, SyncOption, SyncSite } from '@studio/common/types/sync';
export type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
export type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
export type { SupportedLocale } from '@studio/common/lib/locale';
export type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

export type InstalledApps = Record< SupportedEditor | SupportedTerminal, boolean >;

export interface SyncableWpcomSitesPageOptions {
	page?: number;
	perPage?: number;
	search?: string;
}

export interface SyncableWpcomSitesPage {
	sites: SyncSite[];
	total: number;
	page: number;
	perPage: number;
	hasMore: boolean;
	nextPage: number | null;
}

export interface AiSessionSitePlacement {
	kind: 'site';
	siteId: string;
	sitePath: string;
	siteName: string;
}

export type LiveSyncOptions = {
	optionsToSync: SyncOption[];
	specificSelectionPaths?: string[];
	includePathList?: string[];
};

export type LiveSyncDirection = 'push' | 'pull';

export type LiveSyncItem = {
	name: string;
	path: string;
	pathId?: string;
};

export type LiveSyncItems = {
	source: 'local' | 'remote';
	themes: LiveSyncItem[];
	plugins: LiveSyncItem[];
};

export type LiveSyncImportStatus = ImportResponse;

export interface AiSessionPlacementUpdatedEvent {
	sessionId: string;
	placement: AiSessionSitePlacement;
}

export type InstructionFileType = 'agents' | 'claude' | 'studio';

export interface InstructionFileStatus {
	id: InstructionFileType;
	fileName: string;
	displayName: string;
	description: string;
	exists: boolean;
	path: string;
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
	runtime?: SiteRuntime;
	fileAccess?: SiteFileAccess;
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
		supportsWidgets?: boolean;
		supportsMenus?: boolean;
	};
	siteIcon?: string | null;
}

export interface SiteOverviewExtension {
	slug: string;
	name: string;
	status?: string;
	version?: string;
}

export interface SiteOverviewDetails {
	plugins: SiteOverviewExtension[];
	themes: SiteOverviewExtension[];
}

export interface LocalMediaFile {
	name: string;
	mimeType: string;
	data: ArrayBuffer;
}

// What captured a checkpoint: a user action, an agent tool call, the automatic
// pre-tool capture, or the safety capture taken right before a restore.
export type SiteCheckpointTrigger = 'manual' | 'agent' | 'auto-pre-tool' | 'pre-restore';

// One entry of a site's checkpoint index (mirrors the CLI engine's
// `CheckpointIndexEntry`). `createdAt` is epoch milliseconds.
export interface SiteCheckpoint {
	id: string;
	label?: string;
	createdAt: number;
	trigger: SiteCheckpointTrigger;
	// Set for `auto-pre-tool` checkpoints: the agent tool that was about to run.
	toolName?: string;
	pinned?: boolean;
	stats: {
		fileCount: number;
		logicalBytes: number;
		// Bytes of data unique to this checkpoint (not shared with earlier ones).
		newObjectBytes: number;
	};
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
	// Site checkpoints (files + database save points) are available. True on
	// the desktop and the local server (both run the CLI checkpoint engine on
	// the user's machine); false when hosted remotely.
	siteCheckpoints: boolean;
	// `readLocalMediaFile` can read media files from the host's disk (used to
	// render local screenshot artifacts inline). Only the desktop IPC connector
	// supports it; the browser connectors reject local file reads.
	readLocalMedia: boolean;
	// The host can read/write the user's global Studio Code instructions file
	// (~/.studio/knowledge/instructions.md). False when hosted remotely, which
	// hides the Studio Code settings tab.
	agentInstructions: boolean;
	// The host keeps a Studio log file the user can open (`openStudioLogs`).
	// Only the desktop app does — the CLI writes site server output to
	// `~/.studio/daemon/logs` and everything else to the terminal that started
	// it, so there is no single log to point a browser user at.
	studioLogs: boolean;
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
	// True when the connector can gate chat/account features behind auth and
	// the agentic-features preference. Hosted/web mode is always-on — its
	// getAuthUser() returns null by design, so it must be exempt from the
	// signed-out gate.
	supportsAgenticOptOut: boolean;
	isAuthenticated(): Promise< boolean >;
	getAuthUser(): Promise< AuthUser | null >;
	// Starts the WordPress.com OAuth flow in the browser. Pass `signup` to
	// land on account creation instead of login.
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
	// Counts and installed extensions for the site overview page. Implemented
	// with the selected connector's native site-inspection mechanism so it can
	// work even when the local web server is stopped.
	getSiteOverviewDetails( siteId: string ): Promise< SiteOverviewDetails >;
	// Scaffolds a structured plugin into the site's wp-content/plugins folder
	// and activates it. `activated: false` means the files were written but
	// wp-cli activation failed.
	scaffoldPlugin(
		siteId: string,
		meta: PluginScaffoldMeta
	): Promise< { pluginDir: string; activated: boolean } >;
	// Cached screenshot thumbnail captured by the desktop app while the site
	// was running. Returns null when the site has not produced a thumbnail yet.
	getSiteThumbnail( siteId: string ): Promise< string | null >;
	// Xdebug is exclusive across sites; returns the one site currently using
	// it (or null) so the settings form can block a conflicting toggle.
	getXdebugEnabledSite(): Promise< SiteDetails | null >;
	// Whether the Studio root CA is trusted in the OS keychain (HTTPS custom
	// domains). Desktop only.
	isCertificateTrusted(): Promise< boolean >;
	trustCertificate(): Promise< void >;
	// Opens a file relative to the site root in the preferred editor. Desktop only.
	openSiteFileInEditor( siteId: string, relativePath: string ): Promise< void >;
	// Opens wp-content/debug.log in the system default app. Desktop only.
	openSiteDebugLog( siteId: string ): Promise< void >;
	// Per-site agent instruction files (AGENTS.md, CLAUDE.md, STUDIO.md).
	getAgentInstructionsStatus( siteId: string ): Promise< InstructionFileStatus[] >;
	installAgentInstructions(
		siteId: string,
		options?: { fileType?: InstructionFileType; overwrite?: boolean }
	): Promise< void >;
	removeAgentInstruction( siteId: string, fileType: InstructionFileType ): Promise< void >;
	// Per-site WordPress skill overrides (override global skills from Settings).
	getWordPressSkillsStatus( siteId: string ): Promise< SkillStatus[] >;
	installWordPressSkillById( siteId: string, skillId: string ): Promise< void >;
	removeWordPressSkillById( siteId: string, skillId: string ): Promise< void >;

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
	// Resolves a base name to one that doesn't collide with an existing site
	// name or a non-empty site folder ("My Site", "My Site 2", ...), returning
	// it with its proposed directory. The collision search runs in the main
	// process so callers pay a constant number of IPC round-trips.
	findAvailableSitePath( baseName: string ): Promise< AvailableSitePath >;
	generateNumberedSiteName( baseName: string, usedSites: SiteDetails[] ): Promise< string >;
	selectSiteFolder( defaultPath: string ): Promise< SelectedSiteFolder | null >;
	comparePaths( path1: string, path2: string ): Promise< boolean >;

	// Installable WordPress versions from the wordpress.org version-check
	// API: a "latest" auto-updating option first, then nightly/beta and
	// stable releases down to Playground's minimum supported version.
	getWordPressVersions(): Promise< WordPressVersion[] >;
	// Reads the WordPress version installed at the site's path. Resolves to
	// '-' when it can't be determined (missing files, site not found).
	getWpVersion( siteId: string ): Promise< string >;

	// Resolves the absolute filesystem path of a File handle picked or dropped
	// in the renderer. Returns an empty string when the underlying file lacks
	// a real path (synthetic blobs, non-Electron environments).
	getFilePath( file: File ): Promise< string >;
	createTemporaryTextFile( name: string, contents: string ): Promise< string >;
	readLocalMediaFile( path: string ): Promise< LocalMediaFile >;
	// Captures the preview webview's visible viewport at native (device
	// pixel) resolution. Viewport-only: CDP full-page capture doesn't work
	// for webview guests, so full pages use `captureFullPageScreenshot`.
	captureSiteScreenshot(
		webContentsId: number,
		options?: {
			colorScheme?: 'light' | 'dark';
			area?: 'viewport';
		}
	): Promise< LocalMediaFile >;
	// Renders `url` in a headless top-level browser (the CLI's Playwright
	// screenshot pipeline, shared with the agent's `take_screenshot` tool)
	// and returns a full-page JPEG. Fresh page load in a separate session:
	// route admin URLs through `/studio-auto-login`. First use may download
	// the Playwright browser.
	captureFullPageScreenshot(
		url: string,
		options?: { width?: number; colorScheme?: 'light' | 'dark' }
	): Promise< LocalMediaFile >;

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

	// Site checkpoints — content-addressed save points of a site's files +
	// database, captured and restored by the CLI checkpoint engine. Restore
	// automatically captures a safety checkpoint of the current state first.
	listCheckpoints( siteId: string ): Promise< SiteCheckpoint[] >;
	createCheckpoint( siteId: string, label?: string ): Promise< void >;
	restoreCheckpoint( siteId: string, checkpointId: string ): Promise< void >;
	deleteCheckpoint( siteId: string, checkpointId: string ): Promise< void >;

	// Preview snapshots (WordPress.com hosted previews of local sites)
	getSnapshots(): Promise< Snapshot[] >;
	getSnapshotUsage(): Promise< SnapshotUsage | null >;
	getStudioAssistantQuota(): Promise< StudioAssistantQuota | null >;
	deleteAllSnapshots(): Promise< void >;
	// Creates a new preview snapshot for the given site, or refreshes the
	// existing one when `existingHostname` is supplied. Resolves with the
	// final preview URL when the CLI command completes.
	publishPreviewSite( siteId: string, existingHostname?: string ): Promise< { url: string } >;

	// Connected WordPress.com live sites for a given local site
	getConnectedWpcomSites( localSiteId?: string ): Promise< SyncSite[] >;
	// All WordPress.com sites the authenticated user can sync with, regardless
	// of which (if any) local site they're already connected to. The publish
	// picker filters this list to sites that aren't connected anywhere yet.
	fetchSyncableWpcomSites(): Promise< SyncSite[] >;
	// One page of the same list. Used by the onboarding picker to mirror the
	// default Studio UI's first-page + server-side search behavior.
	fetchSyncableWpcomSitesPage(
		options?: SyncableWpcomSitesPageOptions
	): Promise< SyncableWpcomSitesPage >;
	// Persists a new local↔live connection so the dropdown picks it up via
	// `getConnectedWpcomSites`. Safe to call with the minimal `SyncSite` we
	// receive from a sync-connect-site deep link — later fetches backfill the
	// display name and URL.
	connectWpcomSite( localSiteId: string, site: SyncSite ): Promise< void >;
	// Removes a local↔live connection. The remote WordPress.com site is
	// unaffected — only the Studio-side mapping is dropped, so Pull/Push
	// are no longer available until the user reconnects.
	disconnectWpcomSite( localSiteId: string, remoteSiteId: number ): Promise< void >;
	// Pushes selected local content to a previously connected WordPress.com site.
	pushSiteToLive(
		siteId: string,
		remoteSiteId: number,
		options?: LiveSyncOptions
	): Promise< void >;
	// Pulls selected content from the connected WordPress.com site back into
	// the local Studio site. Stops the local server while the backup imports
	// and restarts it on completion.
	pullSiteFromLive(
		siteId: string,
		remoteSiteId: number,
		options?: LiveSyncOptions | ( ( progress: PullSiteProgress ) => void ),
		onProgress?: ( progress: PullSiteProgress ) => void
	): Promise< void >;
	// Lists syncable theme/plugin items from the direction's source side:
	// local files for push, remote backup files for pull.
	getLiveSyncItems(
		siteId: string,
		remoteSiteId: number,
		direction: LiveSyncDirection
	): Promise< LiveSyncItems >;
	// Current status of a remote Studio import. Used by the Agentic UI to
	// keep push progress visible after the archive upload has initiated.
	getLiveSyncImportStatus( remoteSiteId: number ): Promise< LiveSyncImportStatus >;
	// Timestamp of the latest live-site backup, when available.
	getLiveSyncLatestBackupTime( remoteSiteId: number ): Promise< string | null >;
	// Updates Studio's local connected-site metadata after a sync actually completes.
	markLiveSiteSynced(
		localSiteId: string,
		remoteSiteId: number,
		direction: LiveSyncDirection
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
	// Resolve a gated-tool permission request on an active run. The agent
	// blocks on the decision; a run that dies first means the tool never ran.
	answerAgentPermission(
		runId: string,
		requestId: string,
		decision: PermissionDecision
	): Promise< void >;
	onAgentEvent( listener: ( event: AgentRunEvent ) => void ): () => void;
	onSessionPlacementUpdated(
		listener: ( event: AiSessionPlacementUpdatedEvent ) => void
	): () => void;

	// OS notification for chat activity. The caller decides whether the user
	// needs it (they aren't already viewing the session); clicking it focuses
	// the window and fires `onChatNotificationClicked`. No-ops where
	// notifications are unsupported.
	showChatNotification( notification: ChatNotification ): Promise< void >;
	onChatNotificationClicked( listener: ( event: { sessionId: string } ) => void ): () => void;

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
	setUserPreferences(
		partial: Partial< WritableUserPreferences >,
		source?: PreferenceChangeSource
	): Promise< void >;
	previewColorScheme( colorScheme: ColorScheme ): Promise< void >;
	getAppGlobals(): Promise< AppGlobals >;
	onUserSettings( listener: ( tabName?: UserSettingsEventTab ) => void ): () => void;

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

	// Site WordPress REST API. The renderer uses this as the transport for
	// @wordpress/api-fetch / @wordpress/core-data so WordPress entity semantics
	// stay in the WordPress packages while Studio owns site resolution and auth.
	fetchSiteRest( siteId: string, request: SiteRestRequest ): Promise< SiteRestResponse >;

	// Open the given site's folder in the system file manager, preferred
	// editor, or preferred terminal. When no editor/terminal preference is
	// set these reject — callers are expected to route the user to Settings.
	openSiteFolder( siteId: string ): Promise< void >;
	openSiteInEditor( siteId: string ): Promise< void >;
	openSiteInTerminal( siteId: string ): Promise< void >;

	// Open Studio's own log file. Gated by `capabilities.studioLogs`.
	openStudioLogs(): Promise< void >;

	// Analytics — record a Tracks event. The desktop wrapper attaches the surface
	// params (channel/ui_version); see `docs/design-docs/analytics-tracks.md`.
	trackEvent( eventName: TracksEventName, props?: TracksProps ): Promise< void >;

	// External links
	openExternalUrl( url: string ): Promise< void >;

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
	// PNG-encoded data URLs only — both clipboard backends (Electron
	// `nativeImage`, web `ClipboardItem`) reliably accept PNG, so callers
	// re-encode other formats before calling.
	copyImage( pngDataUrl: string ): Promise< void >;
	openSiteUrl(
		siteId: string,
		relativeUrl?: string,
		options?: { autoLogin?: boolean }
	): Promise< void >;
	confirmDeleteAllPreviewSites(): Promise< boolean >;

	// WordPress agent skills applied to all existing and future sites.
	getWordPressSkillsStatusAllSites(): Promise< SkillStatus[] >;
	installWordPressSkillToAllSites( skillId: string ): Promise< void >;
	removeWordPressSkillFromAllSites( skillId: string ): Promise< void >;

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

	// One-time workbench entrance: smoothly grows the desktop window (centered
	// on its current position) so the sidebar, chat/overview, and preview fit
	// comfortably. Resolves once the animation settles. No-ops in the browser
	// and when the window is fullscreen, maximized, or already large enough.
	expandWindowForWorkbench(): Promise< void >;

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

	// Persistent-message dismissals (update cards, announcements). Ids are
	// opaque; dismissing is idempotent and survives relaunches.
	getDismissedMessages(): Promise< string[] >;
	dismissMessage( id: string ): Promise< void >;

	// Agentic UI onboarding state (orientation tour + getting-started
	// checklist). Distinct from getOnboardingCompleted (the pre-workbench
	// first-run welcome flag). setOnboardingHints shallow-merges its partial;
	// completedItems is merged by key. Hosted/web persist to localStorage.
	getOnboardingHints(): Promise< OnboardingHintsState >;
	setOnboardingHints( partial: Partial< OnboardingHintsState > ): Promise< void >;

	// Fires when the user picks Help ▸ Getting Started in the application menu
	// (desktop only). No-ops where there's no OS menu.
	onShowGettingStarted( listener: () => void ): () => void;

	// App updates (desktop only). Hosted returns an inert status and no-op
	// subscribe/install so the messaging layer can call these unconditionally.
	getAppUpdateStatus(): Promise< AppUpdateStatus >;
	onAppUpdateStatusChanged( listener: ( status: AppUpdateStatus ) => void ): () => void;
	installAppUpdate(): Promise< void >;
}

export interface AppUpdateStatus {
	readyToInstall: boolean;
	version: string | null;
}

// Getting-started checklist item ids. Kept as a closed union so the checklist
// definitions, completion watchers, and persistence all agree on the set.
export type ChecklistItemId =
	| 'create-site'
	| 'first-agent-edit'
	| 'visit-overview'
	| 'publish-site'
	| 'find-sync-controls'
	| 'visit-app-settings'
	| 'visit-site-settings';

// Persisted first-run onboarding state for the workbench. Separate from the
// pre-workbench welcome flag (getOnboardingCompleted) and from dismissed
// messages (which are append-only and so can't model replay/un-dismiss).
export interface OnboardingHintsState {
	// Version of the orientation tour the user finished or explicitly skipped.
	tourCompletedVersion?: number;
	// Version of the orientation tour the user closed early (Esc / X).
	tourDismissedVersion?: number;
	// True once the getting-started checklist has been dismissed. Replay clears
	// this — hence it can't ride the append-only dismissedMessages store.
	checklistDismissed?: boolean;
	// True while the checklist is collapsed to its compact (toast-like) bar.
	checklistMinimized?: boolean;
	// Completed checklist items → ISO timestamp of completion.
	completedItems?: Partial< Record< ChecklistItemId, string > >;
	// True once the one-shot publish coachmark has been shown (never re-fires).
	publishCoachmarkShown?: boolean;
	// Captured once, the first time we can tell new from returning: true if the
	// user already had sites when they first reached the app (so the checklist
	// drops "create your first site" and swaps publish for finding sync controls).
	returningUser?: boolean;
}

export interface SkillStatus {
	id: string;
	displayName: string;
	description: string;
	installed: boolean;
}

export interface SnapshotUsage {
	siteCount: number;
	siteLimit: number;
	siteCreationBlocked: boolean;
}

export type ColorScheme = 'system' | 'light' | 'dark';
export type QuitSitesBehavior = 'stop' | 'stop-and-auto-start' | 'leave-running';

// Mirrors the desktop's QuitSitesBehavior storage union, plus 'ask' for the
// unset state (the quit dialog prompts on every quit).
export type QuitSitesBehaviorSetting = 'ask' | 'leave-running' | 'stop-and-auto-start' | 'stop';

export interface UserPreferences {
	editor: SupportedEditor | null;
	terminal: SupportedTerminal | null;
	colorScheme: ColorScheme;
	// Window-chrome ("frame") color override. `null` uses the scheme-aware
	// default; any CSS color string is applied as a single color for both schemes.
	frameColor: string | null;
	locale: string | undefined;
	defaultSiteDirectory: string;
	studioCliInstalled: boolean;
	studioCliExternallyManaged: boolean;
	agenticFeaturesEnabled: boolean;
	analyticsEnabled: boolean;
	chatNotificationsEnabled: boolean;
	activitySoundPreferences: ActivitySoundPreferences;
	quitSitesBehavior: QuitSitesBehaviorSetting;
	agentResponseLength: AiResponseLength;
	defaultAiModel: AiModelId;
	// Per-tool "Always allow" overrides for the agent's gated tools.
	toolPermissions: ToolPermissionOverrides;
}

export type ChatNotificationKind = 'response-complete' | 'pending-question';

export interface ChatNotification {
	sessionId: string;
	kind: ChatNotificationKind;
	title: string;
	body: string;
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

// Attributes a preference write to an in-app surface for settings-change Tracks
// events. `channel`/`ui_version` are attached by the desktop wrapper — not callers.
export interface PreferenceChangeSource {
	surface: 'onboarding' | 'settings';
}

export type UserSettingsEventTab = 'general' | 'account' | 'usage' | 'skills' | 'mcp';

export interface AppGlobals {
	platform: string;
	appName: string;
	appVersion: string;
	arm64Translation: boolean;
	isWindowsStore: boolean;
	enableAgenticUi: boolean;
}

export interface CreateSiteParams {
	name: string;
	path: string;
	phpVersion?: SupportedPHPVersion;
	runtime?: SiteRuntime;
	fileAccess?: SiteFileAccess;
	wpVersion?: string;
	customDomain?: string;
	enableHttps?: boolean;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	// Skips starting the site server after creation. Used by flows that
	// immediately overwrite the fresh install (pulling a connected
	// WordPress.com site), where the sync handler restarts the server itself.
	skipStart?: boolean;
	// Optional blueprint payload. When present, `blueprint` is the parsed
	// blueprint JSON; `filePath` points at the extracted `blueprint.json`
	// inside a ZIP bundle so the CLI can resolve relative asset references.
	// Main process cleans up the temp dir automatically once `createSite`
	// completes.
	blueprint?: {
		blueprint: BlueprintV1Declaration;
		filePath?: string;
	};
	// Telemetry hint for the `studio_site_created` Tracks event. `import`/`sync` are set by the
	// onboarding flows that create a blank site before populating it.
	flowType?: TracksSiteCreateFlowType;
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

export interface AvailableSitePath {
	name: string;
	path: string;
}

// Mirrors PluginScaffoldMeta in apps/studio/src/lib/scaffold-plugin.ts,
// which renders these into the plugin header and readme.txt.
export interface PluginScaffoldMeta {
	slug: string;
	name: string;
	description?: string;
	author?: string;
	version?: string;
	pluginUri?: string;
	authorUri?: string;
	license?: string;
}

export interface SelectedSiteFolder {
	path: string;
	name: string;
	isEmpty: boolean;
	isWordPress: boolean;
}
