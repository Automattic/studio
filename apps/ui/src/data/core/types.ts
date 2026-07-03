import type { ActiveAgentRun, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { AiModelId } from '@studio/common/ai/models';
import type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';
import type { SupportedLocale } from '@studio/common/lib/locale';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { ImportResponse, SyncOption, SyncSite } from '@studio/common/types/sync';
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
} from '@studio/common/ai/sessions/entry-types';
export type { AiModelId } from '@studio/common/ai/models';
export type { Snapshot } from '@studio/common/types/snapshot';
export type { SyncOption, SyncSite } from '@studio/common/types/sync';
export type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
export type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
export type { SupportedLocale } from '@studio/common/lib/locale';

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
	content: {
		pages: number;
		posts: number;
	};
	plugins: SiteOverviewExtension[];
	themes: SiteOverviewExtension[];
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

export interface Connector {
	/**
	 * Optional hook for connector-specific setup that must run after the
	 * connector is constructed but before the UI renders.
	 */
	init?(): Promise< void >;

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
	selectSiteFolder( defaultPath: string ): Promise< SelectedSiteFolder | null >;
	comparePaths( path1: string, path2: string ): Promise< boolean >;

	// Featured blueprints gallery for the "Start from blueprint" onboarding
	// flow. Sourced from the public wpcom/v2/studio-app/blueprints endpoint —
	// no auth required, localized by the user's current UI locale.
	getFeaturedBlueprints( locale?: string ): Promise< FeaturedBlueprint[] >;

	// Installable WordPress versions from the wordpress.org version-check
	// API: a "latest" auto-updating option first, then nightly/beta and
	// stable releases down to Playground's minimum supported version.
	getWordPressVersions(): Promise< WordPressVersion[] >;

	// Resolves the absolute filesystem path of a File handle picked or dropped
	// in the renderer. Returns an empty string when the underlying file lacks
	// a real path (synthetic blobs, non-Electron environments).
	getFilePath( file: File ): Promise< string >;
	createTemporaryTextFile( name: string, contents: string ): Promise< string >;
	readLocalMediaFile( path: string ): Promise< LocalMediaFile >;
	captureSiteScreenshot(
		webContentsId: number,
		options?: { colorScheme?: 'light' | 'dark' }
	): Promise< LocalMediaFile >;

	// Extracts a Blueprint ZIP bundle to a temp directory and returns the
	// parsed `blueprint.json`. The caller is responsible for calling
	// `cleanupBlueprintTempDir` if the extraction succeeds but the upload
	// flow never reaches `createSite` — otherwise `createSite` cleans the
	// temp directory automatically when it uses the extracted blueprint.
	extractBlueprintBundle( zipFilePath: string ): Promise< ExtractedBlueprintBundle >;
	cleanupBlueprintTempDir( tempDir: string ): Promise< void >;
	readBlueprintFile( filePath: string ): Promise< Record< string, unknown > >;
	onAddSiteRequested( listener: () => void ): () => void;
	onAddSiteWithBlueprint( listener: ( payload: { blueprintPath: string } ) => void ): () => void;

	// Imports a backup archive into an already-created site. Extracts the
	// archive, installs the SQLite integration if missing, then imports the
	// archive's database + wp-content on top of the site's folder.
	// `backup.path` comes from `getFilePath`.
	importSiteFromBackup(
		siteId: string,
		backup: { path: string; type: string }
	): Promise< SiteDetails >;

	// Preview snapshots (WordPress.com hosted previews of local sites)
	getSnapshots(): Promise< Snapshot[] >;
	getSnapshotUsage(): Promise< SnapshotUsage | null >;
	deleteAllSnapshots(): Promise< void >;
	// Creates a new preview snapshot for the given site, or refreshes the
	// existing one when `existingHostname` is supplied. Resolves with the
	// final preview URL when the CLI command completes.
	publishPreviewSite( siteId: string, existingHostname?: string ): Promise< { url: string } >;

	// Connected WordPress.com live sites for a given local site
	getConnectedWpcomSites( localSiteId: string ): Promise< SyncSite[] >;
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
		options?: LiveSyncOptions
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

	// AI sessions (shared with the CLI — stored as JSONL on disk)
	getSessions(): Promise< AiSessionSummary[] >;
	getSession( sessionId: string ): Promise< LoadedAiSession >;
	deleteSession( sessionId: string ): Promise< void >;
	updateSessionMetadata(
		sessionId: string,
		patch: Pick< AiSessionSummary, 'starred' | 'archived' >
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
	previewColorScheme( colorScheme: ColorScheme ): Promise< void >;
	selectDefaultSiteDirectory( defaultPath: string ): Promise< string | null >;
	getAppGlobals(): Promise< AppGlobals >;
	onUserSettings( listener: ( tabName?: UserSettingsEventTab ) => void ): () => void;

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

	// External links
	openExternalUrl( url: string ): Promise< void >;

	// Clipboard — routed to the host so it works where the renderer's
	// `navigator.clipboard` is unavailable (e.g. Electron permission denial).
	copyText( text: string ): Promise< void >;
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

	// Window state (macOS fullscreen hides traffic lights, so the UI needs
	// to reclaim the space we normally leave for them).
	isFullscreen(): Promise< boolean >;
	onFullscreenChange( listener: ( fullscreen: boolean ) => void ): () => void;

	// Fires whenever a site is created, updated, started, stopped, or deleted.
	// Consumers typically invalidate cached site data in response.
	onSiteEvent( listener: () => void ): () => void;

	// Fires when the user activates "View > Toggle Site Preview" (⌘⇧B) in the
	// application menu.
	onToggleSitePreview( listener: () => void ): () => void;

	// Fires when the user activates the sidebar toggle shortcut or menu command.
	onToggleSidebar( listener: () => void ): () => void;

	// Persistent-message dismissals (update cards, announcements). Ids are
	// opaque; dismissing is idempotent and survives relaunches.
	getDismissedMessages(): Promise< string[] >;
	dismissMessage( id: string ): Promise< void >;

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

export interface UserPreferences {
	editor: SupportedEditor | null;
	terminal: SupportedTerminal | null;
	colorScheme: ColorScheme;
	locale: string | undefined;
	defaultSiteDirectory: string;
	studioCliInstalled: boolean;
	agenticFeaturesEnabled: boolean;
}

// Subset of UserPreferences that callers can actually mutate. `locale` is
// typed as `SupportedLocale` on the write side because only locales we ship
// translations for can be persisted.
export type WritableUserPreferences = Omit< UserPreferences, 'locale' > & {
	locale: SupportedLocale;
};

export type UserSettingsEventTab = 'general' | 'account' | 'usage' | 'skills' | 'mcp';

export interface AppGlobals {
	platform: string;
	appName: string;
	appVersion: string;
	arm64Translation: boolean;
	isWindowsStore: boolean;
	enableAgenticUi: boolean;
}

export interface FeaturedBlueprint {
	slug: string;
	title: string;
	excerpt: string;
	image: string;
	playgroundUrl: string;
	blueprint: BlueprintV1Declaration;
}

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
	// Skips starting the site server after creation. Used by flows that
	// immediately overwrite the fresh install (pulling a connected
	// WordPress.com site), where the sync handler restarts the server itself.
	skipStart?: boolean;
	// Optional blueprint payload. When present, `blueprint` is the parsed
	// blueprint JSON; `slug` is set for featured blueprints (used for stats);
	// `filePath` points at the extracted `blueprint.json` inside a ZIP bundle
	// so the CLI can resolve relative asset references. Main process cleans
	// up the temp dir automatically once `createSite` completes.
	blueprint?: {
		blueprint: BlueprintV1Declaration;
		slug?: string;
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
