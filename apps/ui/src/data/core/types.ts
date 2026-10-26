import type { ActiveAgentRun, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { AiModelId } from '@studio/common/ai/models';
import type { AiProviderId, AiSettings } from '@studio/common/ai/providers';
import type {
	AiSessionMetadata,
	AiSessionSummary,
	LoadedAiSession,
} from '@studio/common/ai/sessions/types';
import type { StudioVisualAnnotationSummary } from '@studio/common/ai/visual-annotations';
import type { SiteAgentFile, SiteAgentFileKind } from '@studio/common/lib/agent-skills';
import type { SiteEvent, SnapshotEvent } from '@studio/common/lib/cli-events';
import type { SupportedLocale } from '@studio/common/lib/locale';
import type {
	TracksAuthSource,
	TracksEventName,
	TracksProps,
	TracksSiteCreateFlowType,
} from '@studio/common/lib/record-tracks-event';
import type { SiteAgentFileOpenTarget } from '@studio/common/lib/site-agent-file-paths';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { SiteOperation } from '@studio/common/lib/site-operation';
import type { SnapshotUsage } from '@studio/common/lib/snapshots';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
import type { StudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';
import type { SyncEvent } from '@studio/common/lib/sync/activity';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type {
	ColorScheme,
	NewSiteBehavior,
	QuitSitesBehavior,
} from '@studio/common/lib/user-settings/preferences';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
import type { WordPressVersion } from '@studio/common/lib/wordpress-versions';
import type { WpEnvironmentType } from '@studio/common/lib/wp-environment-type';
import type { SiteDesign } from '@studio/common/sites/site-design';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { PullSyncOptions, PushSyncOptions, SyncSite } from '@studio/common/types/sync';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';
import type { DesignFix } from '@studio/design-md';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export type { ActiveAgentRun } from '@studio/common/ai/agent-events';
export type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
export type { StudioChatImage } from '@studio/common/ai/chat-images';
export type {
	AiSessionMetadata,
	AiSessionSummary,
	LoadedAiSession,
} from '@studio/common/ai/sessions/types';
export type { StudioVisualAnnotationSummary } from '@studio/common/ai/visual-annotations';
export type { SessionEntry } from '@earendil-works/pi-coding-agent';
export type { StudioCustomEntry } from '@studio/common/ai/sessions/entry-types';
export type { AiModelId } from '@studio/common/ai/models';
export type { Snapshot } from '@studio/common/types/snapshot';
export type { SnapshotUsage } from '@studio/common/lib/snapshots';
export type { PullSyncOptions, PushSyncOptions, SyncSite } from '@studio/common/types/sync';
export type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
export type { ColorScheme, QuitSitesBehavior } from '@studio/common/lib/user-settings/preferences';
export type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
export type { SupportedLocale } from '@studio/common/lib/locale';
export type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
export type { StudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';
export type { SiteDesign } from '@studio/common/sites/site-design';

export type InstalledApps = Record< SupportedEditor | SupportedTerminal, boolean >;

interface AiSessionSitePlacement {
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
	enableScriptDebug?: boolean;
	environmentType?: WpEnvironmentType;
	sortOrder?: number;
	// True for sites that were running when the app quit with the
	// "Stop, restart on next launch" behavior; the renderer starts them on boot.
	autoStart?: boolean;
	// The Studio operation currently holding the site, from the CLI. Present
	// regardless of who started it — the user, the desktop app, or the agent.
	operation?: SiteOperation;
	// The folder the email the site sends is saved in, from the CLI.
	emailPath?: string;
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
// "am I in Electron"). The desktop app has them all; the browser (`studio ui`)
// does not.
interface ConnectorCapabilities {
	// A native OS folder picker is available (`selectSiteFolder`). When false,
	// the UI offers an editable path field instead.
	nativeFolderPicker: boolean;
	// The preview can host the annotation inspector (script injection + a bridge
	// into the previewed page). Only the desktop's <webview> supports this; in a
	// browser the preview is a cross-origin <iframe> that can't be injected, so
	// the Annotate control is hidden (except on the design system page, which
	// Studio renders itself).
	annotatePreview: boolean;
	// The host keeps a Studio log file the user can open (`openStudioLogs`).
	// Only the desktop app does — the CLI writes site server output to
	// `~/.studio/daemon/logs` and everything else to the terminal that started
	// it, so there is no single log to point a browser user at.
	studioLogs: boolean;
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
	agenticRequiresAuth: boolean;
	getAuthUser(): Promise< AuthUser | null >;
	// `source` records the affordance the login started from, for `studio_wpcom_auth`. Only the IPC
	// connector can report it — the browser connectors have no Main process to record through.
	authenticate( signup?: boolean, source?: TracksAuthSource ): Promise< void >;
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
	// Persists the sidebar's manual site order (each site's `sortOrder`).
	updateSitesSortOrder( updates: { siteId: string; sortOrder: number }[] ): Promise< void >;
	// The last page of the site captured in a preview, shown while it's stopped.
	// Null when the site has not been captured yet.
	getSiteThumbnail( siteId: string ): Promise< string | null >;
	// Captures the preview's page as the site's thumbnail and returns it, or null
	// when that page isn't kept (sign-in and admin screens). The Desktop app
	// captures the preview webview, named by `guestId`.
	captureSitePreview(
		siteId: string,
		capture: { path: string; width: number; height: number; guestId?: number }
	): Promise< string | null >;
	// The site's Site Icon (a data URL, or null when it has none), read on
	// demand when the host can inspect local sites.
	getSiteIcon?( siteId: string ): Promise< string | null >;
	// The site's DESIGN.md and its active theme's theme.json, or null when it
	// lacks either.
	getSiteDesign( siteId: string ): Promise< SiteDesign | null >;
	// Settles drifts between DESIGN.md and theme.json and resolves the result.
	fixSiteDesignDrift( siteId: string, fixes: DesignFix[] ): Promise< SiteDesign | null >;

	// Exports a site as a full backup archive (files + database). Prompts the
	// user for a destination via a save-as dialog; resolves with the chosen
	// path on success, or `null` if the user cancelled the dialog.
	exportFullSite( siteId: string ): Promise< string | null >;
	// Exports only the site database as a .sql dump. Same dialog/cancel
	// semantics as `exportFullSite`.
	exportDatabase( siteId: string ): Promise< string | null >;

	// Site-creation helpers: folder pickers and path validation.
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
	// `backupPath` comes from `getFilePath` for the currently selected file.
	// Its progress and result arrive as sync activity (`onSyncActivity`).
	importSiteFromBackup(
		siteId: string,
		backupPath: string,
		options?: { suppressTracksEvent?: boolean }
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
	// AI credit top-up options priced for the signed-in account. Resolves
	// `null` when pricing can't be fetched (signed out, or the host has no
	// pricing source) so callers can fall back to the single fixed top-up.
	// Prices are formatted for `locale`.
	getStudioAssistantTopUpPricing( locale?: string ): Promise< StudioAssistantTopUpPricing | null >;
	deleteAllSnapshots(): Promise< void >;
	// Asks the user to confirm deleting every preview site on their account.
	// Resolves `true` only when they explicitly confirm.
	confirmDeleteAllPreviewSites(): Promise< boolean >;
	// Creates a new preview snapshot for the given site (named `name` when
	// given), or refreshes the existing one when `existingHostname` is
	// supplied. Resolves with the final preview URL when the CLI command
	// completes.
	publishPreviewSite(
		siteId: string,
		existingHostname?: string,
		name?: string
	): Promise< { url: string } >;
	// Deletes one preview site, both on WordPress.com and from the local list.
	deleteSnapshot( hostname: string ): Promise< void >;
	renameSnapshot( hostname: string, name: string ): Promise< void >;

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
	// Replaces the remote contents with the local database and wp-content,
	// or only the selection described by `options` when provided.
	pushSiteToLive(
		siteId: string,
		remoteSiteId: number,
		options?: PushSyncOptions
	): Promise< void >;
	// Pulls the connected WordPress.com site's database + wp-content back
	// into the local Studio site, or only the selection described by
	// `options` when provided. Stops the local server while the backup
	// imports and restarts it on completion.
	pullSiteFromLive(
		siteId: string,
		remoteSiteId: number,
		options?: PullSyncOptions
	): Promise< void >;
	// Every push, pull and preview, whoever started it, as published by the CLI.
	onSyncActivity( listener: ( event: SyncEvent ) => void ): () => void;
	// Stops an in-flight push or pull, rejecting the operation with a cancelled
	// error. A no-op once the operation is past the point where stopping is safe
	// (`canCancelPush` / `canCancelPull`), and when nothing is running.
	cancelSync( siteId: string, remoteSiteId: number ): Promise< void >;
	// Latest rewind (backup) id of the connected live site, or `null` when no
	// backup exists yet. Selective pull browses the backup tree under this id.
	getLatestRewindId( remoteSiteId: number ): Promise< string | null >;
	// Raw contents of a remote backup directory (rewind backup `ls`), keyed by
	// entry name. Entries are validated and mapped to tree nodes by the UI.
	listRemoteFileTree(
		remoteSiteId: number,
		rewindId: string,
		path: string
	): Promise< Record< string, unknown > >;
	// PHP version of the live site's hosting environment, used to warn about
	// version mismatches before pushing. `undefined` when unavailable.
	getHostingPhpVersion( remoteSiteId: number ): Promise< string | undefined >;
	// Local-site lookups for the selective-sync dialog. The desktop answers
	// from the main process; browser connectors degrade gracefully (empty
	// tree / zero sizes / unknown versions) so category-level selection still
	// works without per-file data.
	listLocalFileTree( siteId: string, path: string, depth: number ): Promise< RawDirectoryEntry[] >;
	getDirectorySize( siteId: string, path: string[] ): Promise< number >;
	getFileSize( siteId: string, path: string[] ): Promise< number >;
	getIsMultisite( siteId: string ): Promise< boolean | undefined >;
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
	updateSessionMetadata( sessionId: string, patch: AiSessionMetadata ): Promise< AiSessionSummary >;

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
			visualAnnotations?: StudioVisualAnnotationSummary[];
		}
	): Promise< { runId: string } >;
	getActiveAgentRuns(): Promise< ActiveAgentRun[] >;
	// Persist a UI-driven model override for the session. The CLI picks this up
	// on the next turn; the change survives reloads because it's written to the
	// session JSONL.
	setSessionModel( sessionId: string, model: AiModelId ): Promise< void >;
	// Pin the session to an AI provider, with the model it should use there.
	// Same mechanism as setSessionModel: an entry in the session JSONL the CLI
	// honors on resume.
	setSessionProvider(
		sessionId: string,
		provider: AiProviderId,
		model: AiModelId
	): Promise< void >;
	// Point the session's next turn at its local site or its connected live site.
	setSessionEnvironment( sessionId: string, environment: 'local' | 'live' ): Promise< void >;
	interruptAgentRun( runId: string ): Promise< void >;
	answerAgentQuestion( runId: string, answers: Record< string, string > ): Promise< void >;
	onAgentEvent( listener: ( event: AgentRunEvent ) => void ): () => void;
	// Fires when a dropped event stream reconnects, so listeners can re-read what they missed.
	onConnectionRestored?( listener: () => void ): () => void;
	onSessionPlacementUpdated(
		listener: ( event: AiSessionPlacementUpdatedEvent ) => void
	): () => void;

	// User preferences — editor, terminal, color scheme, locale. Fanned out to
	// the granular main-process handlers inside the connector so the UI has a
	// single query + mutation to work with.
	getUserPreferences(): Promise< UserPreferences >;
	// A key absent from the patch is left alone; a key present with `null` or
	// `undefined` clears the preference back to its default. Connectors differ
	// in how they encode that (IPC tests key presence, HTTP sends null), so
	// callers must not rely on one connector's leniency.
	setUserPreferences(
		partial: Partial< WritableUserPreferences >,
		source?: PreferenceChangeSource
	): Promise< void >;

	// Opens a native folder picker for the default-site-directory preference.
	// Resolves with the chosen path, or `null` when the user cancels (or the
	// host has no native picker — see capabilities.nativeFolderPicker).
	selectDefaultSiteDirectory( defaultPath: string ): Promise< string | null >;

	// False when Studio has a root certificate (which signs every HTTPS site's
	// certificate) that the OS doesn't trust, so browsers warn about those sites.
	// True before the first HTTPS site: there's no certificate to trust yet.
	isCertificateTrusted(): Promise< boolean >;
	// Trusts it (Windows and Linux ask for administrator access). macOS needs a
	// manual Keychain step, so there it reveals the certificate file instead.
	trustCertificate(): Promise< void >;

	// The user's global Studio Code instructions, a markdown file injected into
	// every agent session.
	getAgentInstructions(): Promise< string >;
	// Whether those instructions reach the agent.
	getAgentInstructionsEnabled(): Promise< boolean >;
	setAgentInstructionsEnabled( enabled: boolean ): Promise< void >;
	// `editSession` marks the save that ends an edit session and carries the value
	// it started from, so it counts as one change. Autosaves omit it.
	saveAgentInstructions(
		content: string,
		options?: { editSession?: { previousContent: string } }
	): Promise< void >;

	// AI provider settings stored in the CLI config. Clearing the key (null)
	// also falls back to WordPress.com.
	getAiSettings(): Promise< AiSettings >;
	saveAnthropicApiKey( key: string | null ): Promise< AiSettings >;
	// The provider new conversations use.
	setAiProvider( provider: AiProviderId ): Promise< AiSettings >;

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
	// Open the folder the site's email is saved in, in the system file manager.
	openSiteEmailFolder( siteId: string ): Promise< void >;

	// The site's WordPress debug log, resolved host-side from the site id. Its
	// existence is a query, not a `SiteDetails` field: the file comes and goes
	// while the UI is open.
	siteDebugLogExists( siteId: string ): Promise< boolean >;
	openSiteDebugLog( siteId: string ): Promise< void >;

	// Open Studio's own log file. Gated by `capabilities.studioLogs`.
	openStudioLogs(): Promise< void >;

	// Analytics — record a Tracks event. The desktop wrapper attaches the surface
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

	// One site's skills and instruction files. Switching one off keeps its
	// edits, out of the folders agents read.
	getSiteAgentFiles( siteId: string, kind: SiteAgentFileKind ): Promise< SiteAgentFile[] >;
	setSiteAgentFileEnabled(
		siteId: string,
		kind: SiteAgentFileKind,
		id: string,
		enabled: boolean
	): Promise< void >;
	removeSiteAgentFile( siteId: string, kind: SiteAgentFileKind, id: string ): Promise< void >;
	openSiteAgentFile(
		siteId: string,
		kind: SiteAgentFileKind,
		id: string,
		target: SiteAgentFileOpenTarget
	): Promise< void >;

	// Whether the UI should render a button that opens the app menu via
	// `popupAppMenu`. True only in the Windows/Linux desktop app, which has no
	// native menu bar; macOS has the native application menu and the browser
	// (`studio ui`) has no app menu at all.
	showsAppMenuButton: boolean;

	// Clipboard — routed to the host so it works where the renderer's
	// `navigator.clipboard` is unavailable (e.g. Electron permission denial).
	copyText( text: string ): Promise< void >;

	// Pops the host's native text context menu. Absent in the browser builds,
	// which already have a real one — there the right-click is left alone.
	showTextContextMenu?( context: {
		selectionText: string;
		isEditable: boolean;
		messageText?: string;
		codeText?: string;
		canQuoteSelection?: boolean;
	} ): Promise< { action: 'quote-selection'; selectionText: string } | undefined >;

	openSiteUrl(
		siteId: string,
		relativeUrl?: string,
		options?: { autoLogin?: boolean }
	): Promise< void >;

	// Whether this host overlays macOS window controls ("traffic lights") on the
	// top-left of the content, so the UI must reserve space for them. True only
	// in the macOS desktop app; false on other platforms and in the browser
	// (`studio ui`), where there are no traffic lights. Combined with
	// `isFullscreen` — macOS hides the traffic lights in fullscreen — to decide
	// when to actually leave the gap (see `useTrafficLightSpace`).
	reservesTrafficLightSpace: boolean;

	// Tells the host which surface the Windows/Linux window-controls overlay is
	// sitting on, so it can repaint them to match (see
	// `useWindowControlsSurface`). Only the Electron host has an overlay.
	setWindowControlsSurface?( surface: 'chrome' | 'content' | 'toolbar' ): Promise< void >;

	// Window state (macOS fullscreen hides traffic lights, so the UI needs
	// to reclaim the space we normally leave for them).
	isFullscreen(): Promise< boolean >;
	onFullscreenChange( listener: ( fullscreen: boolean ) => void ): () => void;

	// Fires whenever a site is created, updated, started, stopped, or deleted.
	// Consumers typically invalidate cached site data in response.
	onSiteEvent( listener: ( event: SiteEvent ) => void ): () => void;
	// Fires whenever a preview site is created, updated or deleted, by anyone.
	onSnapshotEvent( listener: ( event: SnapshotEvent ) => void ): () => void;

	// Fires when the user activates "View > Toggle Site Preview" (⌘⇧B) in the
	// application menu.
	onToggleSitePreview( listener: () => void ): () => void;

	// Fires when the user activates the sidebar toggle shortcut or menu command.
	onToggleSidebar( listener: () => void ): () => void;

	// Fires when the user activates "File > Add Site…" (or its keyboard
	// shortcut) in the application menu.
	onAddSite( listener: () => void ): () => void;
	onAddSiteWithBlueprint( listener: ( payload: { blueprintPath: string } ) => void ): () => void;
	// Tells the host the app now listens for the events links send (Settings, Add
	// site, sync and checkout returns), so a link that arrived earlier opens.
	readyForDeeplinks?(): void;

	// Fires when the user activates "Settings…" (or its keyboard shortcut) in
	// the application menu, or opens a link to one setting.
	onOpenSettings( listener: ( target: { settingId?: string } ) => void ): () => void;

	// Fires when WordPress.com checkout sends the user back after an AI credits
	// top-up (wp-studio://ai-credits-purchased). Desktop only — a browser tab
	// can't receive a custom scheme.
	onAiCreditsPurchased( listener: () => void ): () => void;

	// Agentic UI onboarding state. Distinct from getOnboardingCompleted (the
	// first-run welcome flag). setOnboardingHints shallow-merges
	// its partial. Persisted to app.json.
	getOnboardingHints(): Promise< OnboardingHintsState >;
	setOnboardingHints( partial: Partial< OnboardingHintsState > ): Promise< void >;

	// Fires when the user picks Help ▸ Getting Started in the application menu
	// (desktop only). No-ops where there's no OS menu.
	onShowGettingStarted( listener: () => void ): () => void;

	// Fires when the user picks Help ▸ What's New in the application menu
	// (desktop only). No-ops where there's no OS menu.
	onShowWhatsNew( listener: () => void ): () => void;

	// Auto-updater status.
	getAppUpdateStatus(): Promise< AppUpdateStatus >;
	installAppUpdate(): Promise< void >;
	onAppUpdateStatusChanged( listener: ( status: AppUpdateStatus ) => void ): () => void;

	// Separate from the status above: "already up to date" is a transient answer to a user
	// action, not a lasting state.
	onAppUpdateNotAvailable( listener: ( info: { currentVersion: string } ) => void ): () => void;
}

// Mirrors `AppUpdateStatus` in apps/studio/src/ipc-utils.ts.
export type AppUpdateStatus = (
	| { state: 'idle' | 'checking'; currentVersion: string | null }
	| { state: 'downloading'; currentVersion: string | null; newVersion: string | null }
	| { state: 'ready'; currentVersion: string | null; newVersion: string | null }
	| {
			state: 'error';
			currentVersion: string | null;
			reason: 'read-only-volume' | 'generic';
			detail?: string;
	  }
) & {
	// Set when the user asked for this check, so a dismissed card is shown again.
	requested?: boolean;
};

// Persisted first-run onboarding state for the workbench. Separate from the
// welcome flag (getOnboardingCompleted).
export interface OnboardingHintsState {
	// Version of the orientation guide the user finished or explicitly skipped.
	tourCompletedVersion?: number;
	// Version of the orientation guide the user closed early (Esc / Skip).
	tourDismissedVersion?: number;
	// True when the user reached the agentic workbench by opting in from classic
	// Studio (vs a fresh install that starts here). Drives the guide's first-page
	// "Welcome to WordPress Studio 2.0" migrating copy.
	migratedFromClassic?: boolean;
	// WHATS_NEW_VERSION of the What's New guide the user last saw.
	whatsNewSeenVersion?: number;
}

export type { SiteAgentFile, SiteAgentFileKind };

export interface SkillStatus {
	id: string;
	displayName: string;
	description: string;
	installed: boolean;
}

export interface UserPreferences {
	editor: SupportedEditor | null;
	terminal: SupportedTerminal | null;
	colorScheme: ColorScheme;
	// `null` clears it back to "ask every time".
	quitSitesBehavior?: QuitSitesBehavior | null;
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
	// Whether chat/agent features are offered at all.
	agenticFeaturesEnabled: boolean;
	// The sidebar's Pinned group, in order, as `site:<id>` and `chat:<id>` keys.
	sidebarPins?: string[];
	// Each site's chats in the order the user dragged them into, by site id.
	sidebarChatOrder?: Record< string, string[] >;
	showRecentChats?: boolean;
	// Opening a site's chats in the sidebar folds the others.
	autoCollapseSites?: boolean;
	// Start a stopped local site when a chat message is sent to it.
	autoStartSiteOnChat?: boolean;
	// Ask before discarding preview annotations.
	confirmDeleteAnnotations?: boolean;
	newSiteBehavior?: NewSiteBehavior;
	// The appearance tint: a `#rrggbb` accent color, and percentages.
	accentColor?: string;
	tintIntensity?: number;
	contrast?: number;
}

export interface AppGlobals {
	platform: string;
	isWindowsStore: boolean;
	// Supplied by the desktop host; browser targets do not have an installed
	// Studio app version to report.
	appVersion?: string;
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
// events. `channel`/`ui_version` are attached by the desktop wrapper — not here.
export interface PreferenceChangeSource {
	surface: 'onboarding' | 'settings';
}

export interface CreateSiteParams {
	name: string;
	path: string;
	phpVersion?: SupportedPHPVersion;
	fileAccess?: SiteFileAccess;
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
	// `bundleUrl` is set for API blueprints that bundle resources (theme zips, WXR
	// files); the server downloads and extracts it to resolve relative paths.
	blueprint?: {
		blueprint: BlueprintV1Declaration;
		filePath?: string;
		bundleUrl?: string;
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

export interface SelectedSiteFolder {
	path: string;
	name: string;
	isEmpty: boolean;
	isWordPress: boolean;
}
