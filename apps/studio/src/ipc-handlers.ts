import { exec, ExecOptions } from 'child_process';
import {
	BrowserWindow,
	Menu,
	MenuItem,
	app,
	clipboard,
	dialog,
	nativeImage,
	shell,
	webContents,
	type IpcMainInvokeEvent,
	Notification,
	SaveDialogOptions,
	type WebContents,
} from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import https from 'node:https';
import os from 'os';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { validateStudioChatFiles } from '@studio/common/ai/chat-files';
import { validateStudioChatImages } from '@studio/common/ai/chat-images';
import { isAiModelId } from '@studio/common/ai/models';
import { deriveEffectiveEnvironment } from '@studio/common/ai/sessions/effective-site';
import {
	createOrReuseAiSession,
	hydrateAiSessionSummary,
	listHydratedAiSessions,
	loadHydratedAiSession,
} from '@studio/common/ai/sessions/manage';
import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import {
	deleteAiSessionPlacement,
	readAiSessionPlacement,
} from '@studio/common/ai/sessions/placement';
import { resolveMigratedAiSessionsPath } from '@studio/common/ai/sessions/root-migration';
import {
	appendModelChangeEntry,
	appendStudioEntry,
	deleteAiSession as deleteAiSessionFromStore,
	loadAiSession as loadAiSessionFromStore,
} from '@studio/common/ai/sessions/store';
import { getAiSkillCommands, buildSkillInvocationPrompt } from '@studio/common/ai/slash-commands';
import {
	installSkillToSite,
	removeSkillFromSite,
	updateManagedInstructionFiles,
} from '@studio/common/lib/agent-skills';
import {
	downloadAndExtractBlueprintBundle,
	removeBlueprintTempDir,
} from '@studio/common/lib/blueprint-bundle';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { parseCliError, errorMessageContains } from '@studio/common/lib/cli-error';
import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import {
	calculateDirectorySizeForArchive,
	isWordPressDirectory,
	arePathsEqual,
	isEmptyDir,
	pathExists,
	readLastLines,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { generateNumberedName, generateSiteName } from '@studio/common/lib/generate-site-name';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { isMultisite } from '@studio/common/lib/is-multisite';
import { checkMaintenanceFile } from '@studio/common/lib/maintenance-file';
import { getLocalMediaMimeType } from '@studio/common/lib/media-mime';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { decodePassword, encodePassword } from '@studio/common/lib/passwords';
import { isTracksEventName } from '@studio/common/lib/record-tracks-event';
import {
	getDaemonStatus,
	DaemonStartTimeoutError,
	toRemoteSessionStatus,
	type RemoteSessionStatus,
	type StartDaemonResult,
	type StopDaemonResult,
} from '@studio/common/lib/remote-session';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import {
	deleteSharedSession,
	readSharedConfig,
	updateSharedConfig,
	updateSharedSession,
} from '@studio/common/lib/shared-config';
import { getSiteFileAccess } from '@studio/common/lib/site-file-access';
import { getSiteRuntime, siteModeFromRuntime } from '@studio/common/lib/site-runtime';
import { SYNC_IGNORE_DEFAULTS } from '@studio/common/lib/sync/constants';
import { shouldExcludeFromSync } from '@studio/common/lib/sync/exclude-from-sync';
import { shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { isWordPressDevVersion } from '@studio/common/lib/wordpress-version-utils';
import {
	cleanupBlueprintTempDir as cleanupBlueprintTempDirShared,
	extractBlueprintBundle as extractBlueprintBundleShared,
	type ExtractedBlueprintBundle,
} from '@studio/common/sites/blueprint-extract';
import { measureSiteStorage, type SiteStorageUsage } from '@studio/common/sites/storage-usage';
import { __, sprintf, LocaleData, defaultI18n } from '@wordpress/i18n';
import { MACOS_TRAFFIC_LIGHT_POSITION, MAIN_MIN_WIDTH, SIDEBAR_WIDTH } from 'src/constants';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import {
	getBetaFeatures as getBetaFeaturesFromLib,
	updateBetaFeature as updateBetaFeatureInLib,
	type AgenticUiSurface,
} from 'src/lib/beta-features';
import {
	bumpAggregatedUniqueStat,
	bumpStat,
	getBlueprintMetric,
	getPlatformMetric,
	StatsGroup,
} from 'src/lib/bump-stats';
import {
	openCertificate as openCertificateDialog,
	isRootCATrusted,
	trustRootCA,
} from 'src/lib/certificate-manager';
import {
	showChatNotification as showChatNotificationForWindow,
	type ChatNotificationRequest,
} from 'src/lib/chat-notifications';
import {
	extractErrorFromProcessManagerLogs,
	simplifyErrorForDisplay,
} from 'src/lib/error-formatting';
import { buildFeatureFlags } from 'src/lib/feature-flags';
import { getImageData } from 'src/lib/get-image-data';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { setSentryWpcomUserIdMain } from 'src/lib/main-sentry-utils';
import * as oauthClient from 'src/lib/oauth';
import { scaffoldPluginInSite, type PluginScaffoldMeta } from 'src/lib/scaffold-plugin';
import { getAiInstructionsPath } from 'src/lib/server-files-paths';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { setAgenticUiEnabled } from 'src/lib/studio-ui-mode';
import {
	recordTracksEvent,
	TRACKS_EVENTS,
	type TracksChannel,
	type TracksSiteCreateFlowType,
	type TracksUiVersion,
} from 'src/lib/tracks';
import { updateSiteUrl } from 'src/lib/update-site-url';
import { expandWindowForWorkbench as expandMainWindowForWorkbench } from 'src/lib/window-expansion';
import * as windowsHelpers from 'src/lib/windows-helpers';
import { getLogsFilePath, writeLogToFile, type LogLevel } from 'src/logging';
import {
	getFrameTitleBarOverlayOptions,
	getMainWindow,
	getTitleBarOverlayOptions,
	loadMainWindowRenderer,
} from 'src/main-window';
import { popupMenu, setupMenu } from 'src/menu';
import { type InstructionFileType } from 'src/modules/agent-instructions/constants';
import {
	getAllInstructionFilesStatus,
	installInstructionFile,
	removeInstructionFile,
	type InstructionFileStatus,
} from 'src/modules/agent-instructions/lib/instructions';
import {
	getBundledSkills,
	getSkillsStatus,
	installAllSkills,
	installSkillById,
	removeSkillById,
	type SkillStatus,
} from 'src/modules/agent-instructions/lib/skills';
import {
	answerAgentPermission,
	answerAgentRun,
	interruptAgentRun,
	listActiveAgentRuns,
	startAgentRun,
} from 'src/modules/ai-agent/run-manager';
import { editSiteViaCli, EditSiteOptions } from 'src/modules/cli/lib/cli-site-editor';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { isStudioCliInstalled } from 'src/modules/cli/lib/ipc-handlers';
import { STABLE_BIN_DIR_PATH } from 'src/modules/cli/lib/windows-installation-manager';
import { supportedEditorConfig, SupportedEditor } from 'src/modules/user-settings/lib/editor';
import {
	recordAgenticUiMigration,
	getUserEditor,
	getUserTerminal,
	getDefaultSiteDirectory,
	saveDefaultSiteDirectory,
} from 'src/modules/user-settings/lib/ipc-handlers';
import { linuxFindEditorPath } from 'src/modules/user-settings/lib/linux-editor-path';
import { linuxFindTerminalPath } from 'src/modules/user-settings/lib/linux-terminal-path';
import { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';
import { winFindEditorPath } from 'src/modules/user-settings/lib/win-editor-path';
import {
	SiteServer,
	reconcileSitesRunningState,
	stopAllServers as triggerStopAllServers,
} from 'src/site-server';
import { getSiteThumbnailPath } from 'src/storage/paths';
import {
	updateAppdata,
	loadUserData,
	lockAppdata,
	saveUserData,
	unlockAppdata,
} from 'src/storage/user-data';
import { Blueprint } from 'src/stores/wpcom-api';
import { captureSiteThumbnail } from './lib/capture-site-thumbnail';
import type { ActiveAgentRun } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { AiSessionSummary, LoadedAiSession } from '@studio/common/ai/sessions/types';
import type { PermissionDecision } from '@studio/common/ai/tool-permissions';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';
import type { Ignore } from 'ignore';
import type { WpCliResult } from 'src/site-server';

export {
	isStudioCliInstalled,
	isStudioCliExternallyManaged,
	installStudioCli,
	uninstallStudioCli,
} from 'src/modules/cli/lib/ipc-handlers';

export {
	addSyncOperation,
	cancelSyncOperation,
	clearSyncOperation,
	connectWpcomSites,
	disconnectWpcomSites,
	downloadSyncBackup,
	exportSiteForPush,
	fetchSyncableWpcomSites,
	fetchSyncableWpcomSitesPage,
	getConnectedWpcomSites,
	getLiveSyncImportStatus,
	getLiveSyncItems,
	getLiveSyncLatestBackupTime,
	pauseSyncUpload,
	pullSiteFromLive,
	pushArchive,
	pushSiteToLive,
	removeSyncBackup,
	resumeSyncUpload,
	updateConnectedWpcomSites,
} from 'src/modules/sync/lib/ipc-handlers';

export {
	createSnapshot,
	deleteSnapshot,
	deleteAllSnapshots,
	fetchSnapshots,
	setSnapshot,
	updateSnapshot,
} from 'src/modules/preview-site/lib/ipc-handlers';

export {
	dismissMessage,
	getAgenticFeaturesEnabled,
	getAnalyticsEnabled,
	getAgentResponseLength,
	getActivitySoundPreferences,
	getChatNotificationsEnabled,
	getColorScheme,
	getFrameColor,
	getDefaultAiModel,
	getDismissedMessages,
	getGlobalAgentInstructions,
	getInstalledAppsAndTerminals,
	getOnboardingHints,
	getQuitSitesBehavior,
	getToolPermissions,
	getUserEditor,
	getUserLocale,
	getUserTerminal,
	getWapuuScore,
	previewColorScheme,
	saveAgenticFeaturesEnabled,
	saveAnalyticsEnabled,
	saveAgentResponseLength,
	saveActivitySoundPreferences,
	saveChatNotificationsEnabled,
	saveColorScheme,
	saveFrameColor,
	saveDefaultAiModel,
	saveGlobalAgentInstructions,
	saveOnboardingHints,
	saveQuitSitesBehavior,
	saveToolPermission,
	saveUserEditor,
	saveUserLocale,
	saveUserTerminal,
	saveWapuuScore,
	showUserSettings,
} from 'src/modules/user-settings/lib/ipc-handlers';
export { getDefaultSiteDirectory, saveDefaultSiteDirectory };

export { importSite, exportSite } from 'src/modules/import-export/lib/ipc-handlers';

export {
	listSiteCheckpoints,
	createSiteCheckpoint,
	restoreSiteCheckpoint,
	deleteSiteCheckpoint,
} from 'src/modules/checkpoints/lib/ipc-handlers';

export { fetchSiteRest as fetchSiteRestApi } from 'src/lib/wordpress-rest-api';

export async function recordAnalyticsEvent(
	_event: IpcMainInvokeEvent,
	eventName: string,
	props: Record< string, string | number | boolean | undefined > & {
		channel?: TracksChannel;
		ui_version?: TracksUiVersion;
	} = {}
): Promise< void > {
	if ( ! isTracksEventName( eventName ) ) {
		console.warn( `Ignoring unknown analytics event name: ${ eventName }` );
		return;
	}
	await recordTracksEvent( eventName, props );
}

export async function listAiSessions( _event: IpcMainInvokeEvent ): Promise< AiSessionSummary[] > {
	return listHydratedAiSessions( getSessionsDirectory() );
}

export async function loadAiSession(
	_event: IpcMainInvokeEvent,
	sessionIdOrPrefix: string
): Promise< LoadedAiSession > {
	return loadHydratedAiSession( getSessionsDirectory(), sessionIdOrPrefix );
}

export async function deleteAiSession(
	_event: IpcMainInvokeEvent,
	sessionIdOrPrefix: string
): Promise< AiSessionSummary > {
	const deleted = await deleteAiSessionFromStore( getSessionsDirectory(), sessionIdOrPrefix );
	await deleteSharedSession( deleted.id );
	await deleteAiSessionPlacement( deleted.id );
	return deleted;
}

export async function createAiSession(
	_event: IpcMainInvokeEvent,
	siteId?: string
): Promise< AiSessionSummary > {
	const sessionsRoot = getSessionsDirectory();
	if ( ! siteId ) {
		return createOrReuseAiSession( sessionsRoot );
	}

	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( `Site not found: ${ siteId }` );
	}

	// Binds the session to the site and reuses an existing empty draft for it
	// instead of piling up orphans — the shared logic the `studio ui` server
	// uses too.
	return createOrReuseAiSession( sessionsRoot, {
		site: {
			id: server.details.id,
			name: server.details.name,
			path: server.details.path,
		},
	} );
}

export async function updateAiSessionMetadata(
	_event: IpcMainInvokeEvent,
	sessionIdOrPrefix: string,
	patch: Pick< AiSessionSummary, 'archived' >
): Promise< AiSessionSummary > {
	const { summary } = await loadAiSessionFromStore( getSessionsDirectory(), sessionIdOrPrefix );
	const [ metadata, placement ] = await Promise.all( [
		updateSharedSession( summary.id, patch ),
		readAiSessionPlacement( summary.id ),
	] );
	return hydrateAiSessionSummary( summary, metadata, placement );
}

/**
 * If the session is flagged 'live' but the remote blog id it was targeting is
 * no longer in the user's connected-sites list (e.g. the user disconnected
 * the live site since the last flip), append a `site.selected` event that
 * bumps the session back to its local owner. Keeps the CLI runtime — which
 * only reads the event log — in sync with what the UI already shows.
 *
 * The pill already derives "Local" at render time via the same check; this
 * just records the reconciliation on disk so the agent's system prompt and
 * tool set reflect the same truth on the next turn.
 */
async function reconcileSessionEnvironmentBeforeRun( sessionId: string ): Promise< void > {
	const root = getSessionsDirectory();
	const { summary } = await loadHydratedAiSession( root, sessionId );

	if ( summary.activeEnvironment !== 'live' ) {
		return;
	}
	const ownerSite = findAiSessionOwnerSite( SiteServer.getAllDetails(), summary );
	const ownerServer = ownerSite ? SiteServer.get( ownerSite.id ) : undefined;
	if ( ! ownerServer ) {
		return;
	}

	const connectedForOwner = await getConnectedWpcomSitesForLocalSite( ownerServer.details.id );
	const connectedIds = new Set( connectedForOwner.map( ( site ) => site.id ) );

	const effective = deriveEffectiveEnvironment( summary, ( blogId ) => connectedIds.has( blogId ) );
	if ( effective === 'live' ) {
		return;
	}

	// Live was disconnected since the last flip. Record the fallback so the
	// CLI's replay sees Local on the next turn.
	await appendStudioEntry( root, sessionId, 'studio.site_selected', {
		siteName: ownerServer.details.name,
		sitePath: ownerServer.details.path,
		siteId: ownerServer.details.id,
	} );
}

// Expand a bare skill-command slash prompt (e.g. `/rank-me-up`) into the
// instruction the agent actually acts on. Mirrors the CLI's interactive main
// loop so UI clients can send the short form and get the same behaviour.
function expandSkillCommandPrompt( prompt: string ): string {
	const trimmed = prompt.trim();
	if ( ! trimmed.startsWith( '/' ) ) {
		return prompt;
	}
	const name = trimmed.slice( 1 );
	const match = getAiSkillCommands().find( ( cmd ) => cmd.name === name );
	if ( ! match ) {
		return prompt;
	}
	return buildSkillInvocationPrompt( name );
}

export async function continueAiSession(
	event: IpcMainInvokeEvent,
	sessionId: string,
	prompt: string,
	options: {
		displayMessage?: string;
		images?: StudioChatImage[];
		files?: StudioChatFileAttachment[];
	} = {}
): Promise< { runId: string } > {
	if ( ! ( await oauthClient.isAuthenticated() ) ) {
		throw new Error( __( 'WordPress.com login required. Log in to use Studio Code.' ) );
	}

	await reconcileSessionEnvironmentBeforeRun( sessionId );
	const images = validateStudioChatImages( options.images );
	const files = validateStudioChatFiles( options.files );
	return startAgentRun( {
		sessionId,
		prompt: expandSkillCommandPrompt( prompt ),
		displayMessage: options.displayMessage,
		images,
		files,
		webContents: event.sender,
	} );
}

export async function markAiMessageEdited(
	_event: IpcMainInvokeEvent,
	sessionId: string,
	originalEntryId: string
): Promise< void > {
	await appendStudioEntry( getSessionsDirectory(), sessionId, 'studio.message_edited', {
		originalEntryId,
	} );
}

export async function listActiveAiAgentRuns(
	_event: IpcMainInvokeEvent
): Promise< ActiveAgentRun[] > {
	return listActiveAgentRuns();
}

export async function setAiSessionModel(
	_event: IpcMainInvokeEvent,
	sessionId: string,
	model: string
): Promise< void > {
	if ( ! isAiModelId( model ) ) {
		throw new Error( `Unknown AI model: ${ model }` );
	}
	await appendModelChangeEntry( getSessionsDirectory(), sessionId, '', model );
}

export interface SetSessionEnvironmentResult {
	environment: 'local' | 'live';
	url?: string;
	wpcomSiteId?: number;
	summary: AiSessionSummary;
}

/**
 * Flip a session between operating on its owner site's local runtime vs. the
 * linked WordPress.com live site. The owner site itself never changes — this
 * writes a fresh `site.selected` event naming the concrete site (local or
 * remote) the next turn will act on.
 *
 * Resolves the live endpoint here rather than accepting it from the renderer
 * so a buggy UI can't accidentally rebind the session to a different site.
 */
export async function setSessionEnvironment(
	_event: IpcMainInvokeEvent,
	sessionId: string,
	environment: 'local' | 'live'
): Promise< SetSessionEnvironmentResult > {
	const { summary } = await loadHydratedAiSession( getSessionsDirectory(), sessionId );

	if ( ! summary.ownerSiteId && ! summary.ownerSitePath ) {
		throw new Error( 'Cannot change environment: session has no owner site' );
	}

	const ownerSite = findAiSessionOwnerSite( SiteServer.getAllDetails(), summary );
	const ownerServer = ownerSite ? SiteServer.get( ownerSite.id ) : undefined;
	if ( ! ownerServer ) {
		throw new Error(
			`Cannot change environment: owner site is no longer available (${
				summary.ownerSiteId ?? summary.ownerSitePath
			})`
		);
	}

	if ( environment === 'live' ) {
		const candidates = await getConnectedWpcomSitesForLocalSite( ownerServer.details.id );
		// Prefer the production (non-staging) site to match the UI's
		// `pickLiveSite` behavior in the site dropdown.
		const liveSite = candidates.find( ( s ) => ! s.isStaging ) ?? candidates[ 0 ];

		if ( ! liveSite ) {
			throw new Error( 'Cannot switch to live: no linked WordPress.com site for this session' );
		}

		await appendStudioEntry( getSessionsDirectory(), sessionId, 'studio.site_selected', {
			siteName: liveSite.name,
			// Keep the local owner's path and id on remote picks too, so live/local
			// environment flips still resolve against the same local site.
			sitePath: ownerServer.details.path,
			siteId: ownerServer.details.id,
			remote: true,
			url: liveSite.url,
			wpcomSiteId: liveSite.id,
		} );

		const refreshed = await loadHydratedAiSession( getSessionsDirectory(), sessionId );
		return {
			environment: 'live',
			url: liveSite.url,
			wpcomSiteId: liveSite.id,
			summary: refreshed.summary,
		};
	}

	const details = ownerServer.details;
	await appendStudioEntry( getSessionsDirectory(), sessionId, 'studio.site_selected', {
		siteName: details.name,
		sitePath: details.path,
		siteId: details.id,
		url: 'url' in details ? details.url : undefined,
	} );

	const refreshed = await loadHydratedAiSession( getSessionsDirectory(), sessionId );
	return {
		environment: 'local',
		summary: refreshed.summary,
	};
}

export async function interruptAiAgentRun(
	_event: IpcMainInvokeEvent,
	runId: string
): Promise< void > {
	interruptAgentRun( runId );
}

export async function answerAiAgentQuestion(
	_event: IpcMainInvokeEvent,
	runId: string,
	answers: Record< string, string >
): Promise< void > {
	answerAgentRun( runId, answers );
}

export async function answerAiAgentPermission(
	_event: IpcMainInvokeEvent,
	runId: string,
	requestId: string,
	decision: PermissionDecision
): Promise< void > {
	answerAgentPermission( runId, requestId, decision );
}

export async function getAgentInstructionsStatus(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< InstructionFileStatus[] > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( `Site not found: ${ siteId }` );
	}
	return getAllInstructionFilesStatus( server.details.path );
}

export async function installAgentInstructions(
	_event: IpcMainInvokeEvent,
	siteId: string,
	options?: { overwrite?: boolean; fileType?: InstructionFileType }
): Promise< { path: string; overwritten: boolean } > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( `Site not found: ${ siteId }` );
	}
	const overwrite = options?.overwrite ?? false;
	const fileType = options?.fileType ?? 'agents';
	return installInstructionFile( server.details.path, fileType, overwrite );
}

export async function removeAgentInstruction(
	_event: IpcMainInvokeEvent,
	siteId: string,
	fileType: InstructionFileType
): Promise< void > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( `Site not found: ${ siteId }` );
	}
	await removeInstructionFile( server.details.path, fileType );
}

export async function getWordPressSkillsStatus(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< SkillStatus[] > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( `Site not found: ${ siteId }` );
	}
	return getSkillsStatus( server.details.path );
}

export async function installWordPressSkills(
	_event: IpcMainInvokeEvent,
	siteId: string,
	options?: { overwrite?: boolean }
): Promise< void > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( `Site not found: ${ siteId }` );
	}
	const overwrite = options?.overwrite ?? false;
	await installAllSkills( server.details, overwrite );
}

export async function installWordPressSkillById(
	_event: IpcMainInvokeEvent,
	siteId: string,
	skillId: string,
	options?: { overwrite?: boolean }
): Promise< void > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( `Site not found: ${ siteId }` );
	}
	const overwrite = options?.overwrite ?? false;
	await installSkillById( server.details, skillId, overwrite );
}

export async function removeWordPressSkillById(
	_event: IpcMainInvokeEvent,
	siteId: string,
	skillId: string
): Promise< void > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( `Site not found: ${ siteId }` );
	}
	await removeSkillById( server.details.path, skillId );
}

export async function getWordPressSkillsStatusAllSites(
	_event: IpcMainInvokeEvent
): Promise< SkillStatus[] > {
	const sharedConfig = await readSharedConfig();
	const selectedSkills = sharedConfig.selectedSkills ?? [];
	return getBundledSkills().map( ( skill ) => ( {
		...skill,
		installed: selectedSkills.includes( skill.id ),
	} ) );
}

export async function installWordPressSkillsToAllSites(
	_event: IpcMainInvokeEvent,
	options: { skillId: string; overwrite?: boolean }
): Promise< void > {
	const sites = SiteServer.getAll();
	const overwrite = options.overwrite ?? false;
	const bundledPath = getAiInstructionsPath();
	const tasks = sites.map( ( site ) =>
		installSkillToSite( site.details, bundledPath, options.skillId, overwrite )
	);
	const results = await Promise.allSettled( tasks );
	results.forEach( ( result ) => {
		if ( result.status === 'rejected' ) {
			console.error( '[skills] Failed to install skill:', result.reason );
		}
	} );

	const sharedConfig = await readSharedConfig();
	const existing = sharedConfig.selectedSkills ?? [];
	const merged = Array.from( new Set( [ ...existing, options.skillId ] ) );
	await updateSharedConfig( { selectedSkills: merged } );
}

export async function removeWordPressSkillFromAllSites(
	_event: IpcMainInvokeEvent,
	skillId: string
): Promise< void > {
	const sites = SiteServer.getAll();
	const tasks = sites.map( ( site ) => removeSkillFromSite( site.details.path, skillId ) );
	const results = await Promise.allSettled( tasks );
	results.forEach( ( result ) => {
		if ( result.status === 'rejected' ) {
			console.error( '[skills] Failed to remove skill:', result.reason );
		}
	} );

	const sharedConfig = await readSharedConfig();
	const updated = ( sharedConfig.selectedSkills ?? [] ).filter( ( id ) => id !== skillId );
	await updateSharedConfig( { selectedSkills: updated } );
}

const DEBUG_LOG_MAX_LINES = 50;
const PROCESS_MANAGER_HOME = nodePath.join( os.homedir(), '.studio', 'daemon' );
const DEFAULT_ENCODED_PASSWORD = encodePassword( 'password' );

function readWordPressDebugLog( sitePath: string ): string[] | undefined {
	const debugLogPath = nodePath.join( sitePath, 'wp-content', 'debug.log' );
	return readLastLines( debugLogPath, DEBUG_LOG_MAX_LINES );
}

function findMostRecentLog( logsDir: string, prefix: string, suffix: string ): string | undefined {
	try {
		const files = fs.readdirSync( logsDir );
		const matching = files
			.filter( ( f ) => f.startsWith( prefix ) && f.endsWith( suffix ) )
			.sort()
			.reverse();
		return matching.length > 0 ? nodePath.join( logsDir, matching[ 0 ] ) : undefined;
	} catch {
		return undefined;
	}
}

function readProcessManagerLogs( siteId: string ): { stdout?: string[]; stderr?: string[] } {
	const logsDir = nodePath.join( PROCESS_MANAGER_HOME, 'logs' );
	const prefix = `studio-site-${ siteId }`;
	const stdoutPath = findMostRecentLog( logsDir, `${ prefix }-out-`, '.log' );
	const stderrPath = findMostRecentLog( logsDir, `${ prefix }-error-`, '.log' );

	return {
		stdout: stdoutPath ? readLastLines( stdoutPath, DEBUG_LOG_MAX_LINES ) : undefined,
		stderr: stderrPath ? readLastLines( stderrPath, DEBUG_LOG_MAX_LINES ) : undefined,
	};
}

export async function getSiteDetails( _event: IpcMainInvokeEvent ): Promise< SiteDetails[] > {
	const sites = SiteServer.getAllDetails();
	const userData = await loadUserData();
	await Promise.all(
		sites.map( async ( site ) => {
			const appdataSite = userData.siteMetadata[ site.id ];
			if ( ! appdataSite ) {
				return;
			}
			site.sortOrder = appdataSite.sortOrder;
			site.themeDetails = appdataSite.themeDetails;
			site.siteIconPath = appdataSite.siteIconPath;
			site.autoStart = appdataSite.autoStart;

			// Read the icon file from disk and hand the renderer a data URL.
			// Keeping the base64 out of the persisted appdata avoids bloating
			// app.json with image bytes.
			if ( appdataSite.siteIconPath ) {
				site.siteIcon = await getImageData( appdataSite.siteIconPath );
			} else if ( appdataSite.siteIconPath === null ) {
				site.siteIcon = null;
			}
		} )
	);

	return sites;
}

// Re-query running state before returning details, so the renderer can self-correct a missed event.
export async function reconcileSites( event: IpcMainInvokeEvent ): Promise< SiteDetails[] > {
	await reconcileSitesRunningState();
	return getSiteDetails( event );
}

export async function getXdebugEnabledSite(
	_event: IpcMainInvokeEvent
): Promise< SiteDetails | null > {
	const sites = SiteServer.getAllDetails();
	const xdebugSite = sites.find( ( site ) => site.enableXdebug );
	return xdebugSite || null;
}

export async function createSite(
	event: IpcMainInvokeEvent,
	path: string,
	config: {
		siteName?: string;
		wpVersion?: string;
		customDomain?: string;
		enableHttps?: boolean;
		siteId?: string;
		phpVersion?: string;
		runtime?: SiteRuntime;
		fileAccess?: SiteFileAccess;
		blueprint?: Blueprint;
		adminUsername?: string;
		adminPassword?: string;
		adminEmail?: string;
		noStart?: boolean;
		flowType?: TracksSiteCreateFlowType;
	} = {}
): Promise< SiteDetails > {
	const {
		siteName,
		wpVersion,
		customDomain,
		enableHttps,
		siteId: providedSiteId,
		blueprint,
		phpVersion,
		runtime,
		fileAccess,
		adminUsername,
		adminPassword,
		adminEmail,
		noStart = false,
		flowType,
	} = config;

	const siteId = providedSiteId || crypto.randomUUID();

	const metric = getBlueprintMetric( blueprint?.slug );
	bumpStat( StatsGroup.STUDIO_SITE_CREATE, metric );

	// If the blueprint has a bundle_url (API blueprints with bundled resources like zips),
	// download and extract the bundle so bundled resources can be resolved locally.
	let bundleTempDir: string | undefined;
	let blueprintFilePath = blueprint?.filePath;
	if ( blueprint?.bundle_url && ! blueprintFilePath ) {
		const result = await downloadAndExtractBlueprintBundle( blueprint.bundle_url );
		bundleTempDir = result.tempDir;
		blueprintFilePath = result.blueprintJsonPath;
	}

	try {
		const { server } = await SiteServer.create(
			{
				path,
				name: siteName,
				wpVersion,
				phpVersion,
				runtime,
				fileAccess,
				customDomain,
				enableHttps,
				siteId,
				blueprint: blueprint?.blueprint,
				originalBlueprintPath: blueprintFilePath,
				adminUsername,
				adminPassword,
				adminEmail,
				noStart,
				flowType,
			},
			{ wpVersion, blueprint: blueprint?.blueprint }
		);

		// If the site is running after creation, fetch theme details and update thumbnail
		if ( server.details.running ) {
			void loadThemeDetails( event, server.details.id );
			void loadSiteIcon( event, server.details.id );
		}

		return server.details;
	} catch ( error ) {
		// Skip WASM memory errors - they're user system issues, not bugs
		if ( errorMessageContains( error, 'Cannot allocate Wasm memory for new instance' ) ) {
			throw new Error( 'WASM_ERROR_NOT_ENOUGH_MEMORY' );
		}

		const contexts: Record< string, Record< string, unknown > > = {
			site: {
				hasBlueprint: !! blueprint,
				wpVersion,
				phpVersion,
				hasCustomDomain: !! customDomain,
				httpsEnabled: !! enableHttps,
			},
		};

		const cliError = parseCliError( error );
		if ( cliError?.cliArgs ) {
			contexts.startup = cliError.cliArgs;
		}

		const debugLog = readWordPressDebugLog( path );
		if ( debugLog && debugLog.length > 0 ) {
			contexts.debugLog = { entries: debugLog };
		}

		const processManagerLogs = readProcessManagerLogs( siteId );
		if ( processManagerLogs.stdout && processManagerLogs.stdout.length > 0 ) {
			contexts.playgroundLogs = { entries: processManagerLogs.stdout };
		}
		if ( processManagerLogs.stderr && processManagerLogs.stderr.length > 0 ) {
			contexts.playgroundErrors = { entries: processManagerLogs.stderr };
		}

		Sentry.captureException( error, {
			tags: {
				provider: 'cli',
			},
			contexts,
		} );

		// If the error message is generic, try to surface a more useful message from
		// the process manager logs. The detailed error is often captured in stdout
		// (e.g. blueprint execution errors logged by playground-cli).
		const logErrorMessage = extractErrorFromProcessManagerLogs( processManagerLogs );
		if ( logErrorMessage ) {
			throw new Error( logErrorMessage );
		}

		throw error;
	} finally {
		if ( bundleTempDir ) {
			await removeBlueprintTempDir( bundleTempDir ).catch( () => {} );
		} else if ( blueprint?.filePath ) {
			const blueprintDir = nodePath.dirname( nodePath.resolve( blueprint.filePath ) );
			await removeBlueprintTempDir( blueprintDir ).catch( () => {} );
		}
	}
}

// Update a site's details (name, custom domain, PHP version, etc). This function calls the
// `site set` CLI command and updates the `SiteServer` instance after the CLI completes.
export async function updateSite(
	event: IpcMainInvokeEvent,
	updatedSite: SiteDetails,
	wpVersion?: string
): Promise< void > {
	const server = SiteServer.get( updatedSite.id );
	if ( ! server ) {
		throw new Error( `Site not found: ${ updatedSite.id }` );
	}

	const currentSite = server.details;

	const options: EditSiteOptions = {
		path: currentSite.path,
		siteId: updatedSite.id,
	};

	if ( updatedSite.name !== currentSite.name ) {
		options.name = updatedSite.name;
	}

	if ( updatedSite.customDomain !== currentSite.customDomain ) {
		options.domain = updatedSite.customDomain ?? '';
	}

	if ( updatedSite.enableHttps !== currentSite.enableHttps ) {
		options.https = updatedSite.enableHttps ?? false;
	}

	if ( updatedSite.phpVersion !== currentSite.phpVersion ) {
		options.php = updatedSite.phpVersion;
	}

	if ( wpVersion ) {
		options.wp = isWordPressDevVersion( wpVersion ) ? 'nightly' : wpVersion;
	}

	if ( getSiteRuntime( updatedSite ) !== getSiteRuntime( currentSite ) ) {
		options.runtime = siteModeFromRuntime( getSiteRuntime( updatedSite ) );
	}

	if ( getSiteFileAccess( updatedSite ) !== getSiteFileAccess( currentSite ) ) {
		options.fileAccess = getSiteFileAccess( updatedSite );
	}

	if ( updatedSite.enableXdebug !== currentSite.enableXdebug ) {
		options.xdebug = updatedSite.enableXdebug ?? false;
	}

	if ( ( updatedSite.adminUsername ?? 'admin' ) !== ( currentSite.adminUsername ?? 'admin' ) ) {
		options.adminUsername = updatedSite.adminUsername;
	}

	if (
		( updatedSite.adminPassword ?? DEFAULT_ENCODED_PASSWORD ) !==
		( currentSite.adminPassword ?? DEFAULT_ENCODED_PASSWORD )
	) {
		// CLI set expects plain text password (it encodes before saving)
		options.adminPassword = decodePassword( updatedSite.adminPassword ?? DEFAULT_ENCODED_PASSWORD );
	}

	if ( ( updatedSite.adminEmail ?? '' ) !== ( currentSite.adminEmail ?? '' ) ) {
		options.adminEmail = updatedSite.adminEmail;
	}

	if ( updatedSite.enableDebugLog !== currentSite.enableDebugLog ) {
		options.debugLog = updatedSite.enableDebugLog ?? false;
	}

	if ( updatedSite.enableDebugDisplay !== currentSite.enableDebugDisplay ) {
		options.debugDisplay = updatedSite.enableDebugDisplay ?? false;
	}

	const hasCliChanges = Object.keys( options ).length > 2;

	if ( hasCliChanges ) {
		await editSiteViaCli( options );
	}
}

export async function startServer( event: IpcMainInvokeEvent, id: string ): Promise< void > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return;
	}

	const maintenanceCheck = checkMaintenanceFile( server.details.path );
	if ( maintenanceCheck.exists && ! maintenanceCheck.isStale ) {
		throw new Error( 'MAINTENANCE_MODE' );
	}

	try {
		await server.start();
	} catch ( error ) {
		try {
			await server.persistAutoStart( false );
		} catch {
			// Ignore errors persisting auto-start state
		}

		// Skip WASM memory errors - they're user system issues, not bugs
		if ( errorMessageContains( error, 'Cannot allocate Wasm memory for new instance' ) ) {
			throw new Error( 'WASM_ERROR_NOT_ENOUGH_MEMORY' );
		}

		// Capacity limit is expected behavior, not a bug — skip Sentry
		if ( errorMessageContains( error, 'CAPACITY_LIMIT_REACHED' ) ) {
			throw new Error( 'CAPACITY_LIMIT_REACHED' );
		}

		const contexts: Record< string, Record< string, unknown > > = {
			server: {
				running: server.details.running,
				phpVersion: server.details.phpVersion,
				port: server.details.port,
				hasCustomDomain: !! server.details.customDomain,
				httpsEnabled: !! server.details.enableHttps,
			},
		};

		const cliError = parseCliError( error );
		if ( cliError?.cliArgs ) {
			contexts.startup = cliError.cliArgs;
		}

		const debugLog = readWordPressDebugLog( server.details.path );
		if ( debugLog && debugLog.length > 0 ) {
			contexts.debugLog = { entries: debugLog };
		}

		const processManagerLogs = readProcessManagerLogs( id );
		if ( processManagerLogs.stdout && processManagerLogs.stdout.length > 0 ) {
			contexts.playgroundLogs = { entries: processManagerLogs.stdout };
		}
		if ( processManagerLogs.stderr && processManagerLogs.stderr.length > 0 ) {
			contexts.playgroundErrors = { entries: processManagerLogs.stderr };
		}

		Sentry.captureException( error, {
			tags: {
				provider: 'cli',
			},
			contexts,
		} );

		if ( errorMessageContains( error, '"unreachable" WASM instruction executed' ) ) {
			throw new Error( 'Please try disabling plugins and themes that might be causing the issue.' );
		}
		throw error;
	}

	if ( server.details.running ) {
		void loadThemeDetails( event, id );
		void loadSiteIcon( event, id );
	}

	// Keep managed instruction files (STUDIO.md) up-to-date
	void updateManagedInstructionFiles( server.details, getAiInstructionsPath() ).catch(
		( error ) => {
			console.error( '[ai-instructions] Failed to update managed instruction files:', error );
		}
	);

	console.log( `Server started for '${ server.details.name }'` );
}

export async function stopServer( event: IpcMainInvokeEvent, id: string ): Promise< void > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return;
	}

	await server.stop();
	// Stopping a single site by hand clears its auto-start. SiteServer.stop() pre-empts the running
	// transition the events subscriber relies on, so persist it explicitly here.
	await server.persistAutoStart( false );
}

export async function stopAllServers(): Promise< void > {
	await triggerStopAllServers();
}

export interface FolderDialogResponse {
	path: string;
	name: string;
	isEmpty: boolean;
	isWordPress: boolean;
	isNameTooLong?: boolean;
}

export async function showSaveAsDialog( event: IpcMainInvokeEvent, options: SaveDialogOptions ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow ) {
		throw new Error( `No window found for sender of showSaveAsDialog message: ${ event.frameId }` );
	}

	let defaultPath = options.defaultPath;
	if (
		typeof options.defaultPath === 'string' &&
		options.defaultPath === nodePath.basename( options.defaultPath )
	) {
		const defaultSiteDirectory = await getDefaultSiteDirectory();
		defaultPath = nodePath.join( defaultSiteDirectory, options.defaultPath );
	}
	const { canceled, filePath } = await dialog.showSaveDialog( parentWindow, {
		defaultPath,
		...options,
	} );
	if ( canceled ) {
		return '';
	}
	return filePath;
}

export async function showOpenFolderDialog(
	event: IpcMainInvokeEvent,
	title: string,
	defaultDialogPath: string
): Promise< FolderDialogResponse | null > {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow ) {
		throw new Error(
			`No window found for sender of showOpenFolderDialog message: ${ event.frameId }`
		);
	}

	if ( process.env.E2E && process.env.E2E_OPEN_FOLDER_DIALOG ) {
		// Playwright's filechooser event isn't working in our e2e tests.
		// Use an environment variable to manually set which folder gets selected.
		return {
			path: process.env.E2E_OPEN_FOLDER_DIALOG,
			name: nodePath.basename( process.env.E2E_OPEN_FOLDER_DIALOG ),
			isEmpty: await isEmptyDir( process.env.E2E_OPEN_FOLDER_DIALOG ),
			isWordPress: isWordPressDirectory( process.env.E2E_OPEN_FOLDER_DIALOG ),
		};
	}

	const defaultPath =
		defaultDialogPath !== '' ? defaultDialogPath : await getDefaultSiteDirectory();
	const { canceled, filePaths } = await dialog.showOpenDialog( parentWindow, {
		title,
		defaultPath,
		properties: [
			'openDirectory',
			'createDirectory', // allow user to create new directories; macOS only
		],
	} );
	if ( canceled ) {
		return null;
	}

	return {
		path: filePaths[ 0 ],
		name: nodePath.basename( filePaths[ 0 ] ),
		isEmpty: await isEmptyDir( filePaths[ 0 ] ),
		isWordPress: isWordPressDirectory( filePaths[ 0 ] ),
	};
}

export async function getSentryUserId( _event: IpcMainInvokeEvent ) {
	const userData = await loadUserData();
	return userData.sentryUserId;
}

export async function deleteSite( event: IpcMainInvokeEvent, id: string, deleteFiles = false ) {
	const server = SiteServer.get( id );
	console.log( 'Deleting site', id );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}
	await server.delete( deleteFiles );
}

export async function copySite(
	event: IpcMainInvokeEvent,
	sourceSiteId: string,
	newSiteId: string,
	siteName: string
): Promise< SiteDetails > {
	const sourceServer = SiteServer.get( sourceSiteId );
	if ( ! sourceServer ) {
		throw new Error( 'Source site not found.' );
	}
	const sourceSite = sourceServer.details;

	const defaultSiteDirectory = await getDefaultSiteDirectory();
	const finalSitePath = nodePath.join( defaultSiteDirectory, sanitizeFolderName( siteName ) );

	console.log( `Copying site '${ sourceSite.name }' to '${ siteName }'` );

	await recursiveCopyDirectory( sourceSite.path, finalSitePath );

	const sourceThumbnailPath = getSiteThumbnailPath( sourceSiteId );
	const newThumbnailPath = getSiteThumbnailPath( newSiteId );
	if ( fs.existsSync( sourceThumbnailPath ) ) {
		await fs.promises.copyFile( sourceThumbnailPath, newThumbnailPath );
		const thumbnailData = await getImageData( newThumbnailPath );
		sendIpcEventToRendererWithWindow(
			BrowserWindow.fromWebContents( event.sender ),
			'thumbnail-loaded',
			{ id: newSiteId, imageData: thumbnailData }
		);
	}

	const { server, details } = await SiteServer.create( {
		path: finalSitePath,
		name: siteName,
		siteId: newSiteId,
		phpVersion: sourceSite.phpVersion,
		// Copies keep the source site's runtime settings rather than picking up
		// the default for new sites.
		runtime: getSiteRuntime( sourceSite ),
		fileAccess: sourceSite.fileAccess,
		adminUsername: sourceSite.adminUsername,
		adminPassword: sourceSite.adminPassword
			? decodePassword( sourceSite.adminPassword )
			: undefined,
		adminEmail: sourceSite.adminEmail,
		noStart: true,
		flowType: 'duplicate',
	} );

	// Playground sets the correct siteurl internally, but for the native-php runtime, we need to
	// explicitly update that option
	await updateSiteUrl( server, `http://localhost:${ details.port }` );

	// Persist themeDetails to appdata (Studio-only data)
	if ( sourceSite.themeDetails ) {
		server.details.themeDetails = sourceSite.themeDetails;
		await server.persistThemeDetails();
	}

	return details;
}

export function logRendererMessage(
	event: IpcMainInvokeEvent,
	level: LogLevel,
	...args: unknown[]
): void {
	// 4 characters long so it aligns with the main process logs
	const processId = `ren${ event.sender.id }`;
	writeLogToFile( level, processId, ...args );
}

export async function authenticate( event: IpcMainInvokeEvent, isSignup = false ) {
	const locale = await getUserLocaleWithFallback();
	const authUrl = isSignup ? oauthClient.getSignUpUrl( locale ) : getAuthenticationUrl( locale );
	void shellOpenExternalWrapper( authUrl );
}

export async function getAuthenticationToken() {
	return oauthClient.getAuthenticationToken();
}

export async function isAuthenticated() {
	return oauthClient.isAuthenticated();
}

export async function clearAuthenticationToken() {
	setSentryWpcomUserIdMain( undefined );
	return await updateSharedConfig( { authToken: undefined } );
}

export async function saveLastSeenVersion( event: IpcMainInvokeEvent, version: string ) {
	await updateAppdata( { lastSeenVersion: version } );
}

export async function getLastSeenVersion(
	_event: IpcMainInvokeEvent
): Promise< string | undefined > {
	// If we're running in E2E mode, return the app version
	if ( process.env.E2E ) {
		return app.getVersion();
	}
	const userData = await loadUserData();
	return userData.lastSeenVersion;
}

export async function openSiteURL(
	event: IpcMainInvokeEvent,
	id: string,
	relativeURL = '',
	{ autoLogin = true }: { autoLogin?: boolean } = {}
) {
	const site = SiteServer.get( id );
	if ( ! site?.server?.url ) {
		await showMessageBox( event, {
			type: 'error',
			message: __( 'Failed to open link' ),
			detail: __( 'Please ensure your site files have not been moved or deleted.' ),
		} );
		return;
	}

	// When the caller didn't ask for a specific path (the generic "Open site"
	// entry points pass `''`), honor the Blueprint-provided `landingPage` if
	// the site has one. Explicit relative paths (e.g. `/wp-admin/`) still win.
	const usingLandingPage = ! relativeURL && !! site.details.landingPage;
	const targetPath = relativeURL || site.details.landingPage || '';
	let url = new URL( targetPath, site.server.url );
	// Blueprint landing pages may point at admin screens; force auto-login so
	// users don't get bounced to the login page. This matches Playground's
	// "always-logged-in sandbox" behavior for Blueprint-imported sites.
	if ( autoLogin || usingLandingPage ) {
		const autoLoginUrl = new URL( '/studio-auto-login', site.server.url );
		autoLoginUrl.searchParams.append( 'redirect_to', url.toString() );
		url = autoLoginUrl;
	}

	void shellOpenExternalWrapper( url.toString() );
}

export function openURL( event: IpcMainInvokeEvent, url: string ) {
	void shellOpenExternalWrapper( url );
}

export function copyText( event: IpcMainInvokeEvent, text: string ) {
	return clipboard.writeText( text );
}

export async function copyImage( event: IpcMainInvokeEvent, pngDataUrl: string ) {
	const image = nativeImage.createFromDataURL( pngDataUrl );
	if ( image.isEmpty() ) {
		throw new Error( 'Could not decode image data URL' );
	}
	clipboard.writeImage( image );
}

export function getAppGlobals(): AppGlobals {
	return {
		platform: process.platform,
		appName: app.name,
		appVersion: app.getVersion(),
		arm64Translation: app.runningUnderARM64Translation,
		isWindowsStore: process.windowsStore ?? false,
		...buildFeatureFlags(),
	};
}

export function getWpVersion( _event: IpcMainInvokeEvent, id: string ) {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return '-';
	}
	const wordPressPath = server.details.path;
	return getWordPressVersion( wordPressPath );
}

export async function getSiteStorageUsage(
	_event: IpcMainInvokeEvent,
	id: string
): Promise< SiteStorageUsage | null > {
	const server = SiteServer.get( id );
	return server ? measureSiteStorage( server.details.path ) : null;
}

export function getIsMultisite( _event: IpcMainInvokeEvent, id: string ) {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return false;
	}
	return isMultisite( server.details.path );
}

export async function generateProposedSitePath(
	_event: IpcMainInvokeEvent,
	siteName: string
): Promise< FolderDialogResponse > {
	const defaultSiteDirectory = await getDefaultSiteDirectory();
	const path = nodePath.join( defaultSiteDirectory, sanitizeFolderName( siteName ) );

	try {
		return {
			path,
			name: siteName,
			isEmpty: await isEmptyDir( path ),
			isWordPress: isWordPressDirectory( path ),
		};
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return {
				path,
				name: siteName,
				isEmpty: true,
				isWordPress: false,
			};
		}
		if ( isErrnoException( err ) && err.code === 'ENAMETOOLONG' ) {
			return {
				path,
				name: siteName,
				isEmpty: false,
				isWordPress: false,
				isNameTooLong: true,
			};
		}
		throw err;
	}
}

export async function generateSiteNameFromList(
	_event: IpcMainInvokeEvent,
	usedSites: SiteDetails[]
): Promise< string > {
	const defaultSiteDirectory = await getDefaultSiteDirectory();
	return generateSiteName(
		usedSites.map( ( s ) => s.name ),
		defaultSiteDirectory
	);
}

export async function generateNumberedNameFromList(
	_event: IpcMainInvokeEvent,
	baseName: string,
	usedSites: SiteDetails[]
): Promise< string > {
	const defaultSiteDirectory = await getDefaultSiteDirectory();
	return generateNumberedName(
		baseName,
		usedSites.map( ( s ) => s.name ),
		defaultSiteDirectory
	);
}

export async function openLocalPath( _event: IpcMainInvokeEvent, path: string ) {
	await shell.openPath( path );
}

export function showItemInFolder( _event: IpcMainInvokeEvent, path: string ) {
	shell.showItemInFolder( path );
}

function sanitizeTemporaryTextFileName( name: string ): string {
	const fallbackName = 'browser-console.txt';
	const normalized = nodePath
		.basename( typeof name === 'string' && name ? name : fallbackName )
		.replace( /[^a-zA-Z0-9._-]/g, '-' );
	const withExtension = normalized.toLowerCase().endsWith( '.txt' )
		? normalized
		: `${ normalized }.txt`;
	return withExtension || fallbackName;
}

export async function createTemporaryTextFile(
	_event: IpcMainInvokeEvent,
	name: string,
	contents: string
): Promise< string > {
	if ( typeof contents !== 'string' ) {
		throw new Error( 'Temporary text file contents must be a string.' );
	}

	const directory = nodePath.join( app.getPath( 'temp' ), 'com.wordpress.studio', 'attachments' );
	await fsPromises.mkdir( directory, { recursive: true } );
	const fileName = `${ crypto.randomUUID() }-${ sanitizeTemporaryTextFileName( name ) }`;
	const filePath = nodePath.join( directory, fileName );
	await fsPromises.writeFile( filePath, contents, 'utf8' );
	return filePath;
}

export async function openStudioLogs( _event: IpcMainInvokeEvent ) {
	await shell.openPath( getLogsFilePath() );
}

export async function readLocalMediaFile(
	_event: IpcMainInvokeEvent,
	path: string
): Promise< { name: string; mimeType: string; data: ArrayBuffer } > {
	let resolvedPath = path;
	let stats: fs.Stats;
	try {
		stats = await fsPromises.stat( resolvedPath );
	} catch ( error ) {
		if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
			throw error;
		}
		resolvedPath = resolveMigratedAiSessionsPath( path );
		if ( resolvedPath === path ) {
			throw error;
		}
		stats = await fsPromises.stat( resolvedPath );
	}
	if ( ! stats.isFile() ) {
		throw new Error( 'Local media path must be a file.' );
	}

	const mimeType = getLocalMediaMimeType( path );
	if ( ! mimeType ) {
		throw new Error( 'Local media file type is not supported.' );
	}

	const buffer = await fsPromises.readFile( resolvedPath );
	return {
		name: nodePath.basename( path ),
		mimeType,
		data: buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength
		) as ArrayBuffer,
	};
}

// Captures the webview's visible viewport at native (device pixel)
// resolution. Viewport-only by design: CDP has no working full-page capture
// for webview guests (`clip` silently produces blank images,
// `captureBeyondViewport` and viewport emulation both tile the visible
// surface down the page) — full pages go through
// `captureFullPageScreenshot`, which renders in a headless top-level
// browser instead. `area` is accepted for call-site clarity.
export async function captureSiteScreenshot(
	event: IpcMainInvokeEvent,
	webContentsId: number,
	options: {
		colorScheme?: 'light' | 'dark';
		area?: 'viewport';
	} = {}
): Promise< { name: string; mimeType: string; data: ArrayBuffer } > {
	if ( options.colorScheme && options.colorScheme !== 'light' && options.colorScheme !== 'dark' ) {
		throw new Error( 'Unsupported screenshot color scheme.' );
	}
	if ( options.area && options.area !== 'viewport' ) {
		throw new Error( 'Unsupported screenshot area.' );
	}

	const target = getOwnedWebviewContents( event, webContentsId );
	attachDebuggerIfNeeded( target );
	if ( options.colorScheme ) {
		await sendDebuggerCommand( target, 'Emulation.setEmulatedMedia', {
			features: [ { name: 'prefers-color-scheme', value: options.colorScheme } ],
		} );
	}

	const screenshot = await sendDebuggerCommand< { data: string } >(
		target,
		'Page.captureScreenshot',
		{
			format: 'jpeg',
			quality: 80,
			captureBeyondViewport: false,
		}
	);

	const buffer = Buffer.from( screenshot.data, 'base64' );
	return {
		name: `screenshot-viewport${ options.colorScheme ? `-${ options.colorScheme }` : '' }.jpg`,
		mimeType: 'image/jpeg',
		data: buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength
		) as ArrayBuffer,
	};
}

// Full-page screenshots delegate to the CLI's Playwright pipeline (the same
// engine as the agent's `take_screenshot` tool): a headless top-level page
// renders the whole document correctly in one pass, with lazy-image
// scrolling and font settling handled there. First use may download the
// Playwright browser. The capture runs against a fresh page load in a
// separate browser session, so admin URLs should be routed through the
// site's `/studio-auto-login` endpoint by the caller.
export async function captureFullPageScreenshot(
	_event: IpcMainInvokeEvent,
	url: string,
	options: { width?: number; colorScheme?: 'light' | 'dark' } = {}
): Promise< { name: string; mimeType: string; data: ArrayBuffer } > {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL( url );
	} catch {
		throw new Error( 'Unsupported screenshot URL.' );
	}
	if ( parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:' ) {
		throw new Error( 'Unsupported screenshot URL.' );
	}
	if ( options.colorScheme && options.colorScheme !== 'light' && options.colorScheme !== 'dark' ) {
		throw new Error( 'Unsupported screenshot color scheme.' );
	}
	const width = options.width === undefined ? undefined : Math.round( options.width );
	if ( width !== undefined && ( ! Number.isFinite( width ) || width < 200 || width > 4000 ) ) {
		throw new Error( 'Unsupported screenshot width.' );
	}

	const outPath = nodePath.join(
		os.tmpdir(),
		`studio-page-clip-${ Date.now().toString( 36 ) }-${ Math.random()
			.toString( 36 )
			.slice( 2, 8 ) }.jpg`
	);
	const args = [ 'screenshot', url, '--out', outPath ];
	if ( width !== undefined ) {
		args.push( '--width', String( width ) );
	}
	if ( options.colorScheme ) {
		args.push( '--color-scheme', options.colorScheme );
	}

	await new Promise< void >( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand( args, { output: 'capture' } );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );

	try {
		const buffer = await fsPromises.readFile( outPath );
		return {
			name: `clip-page${ options.colorScheme ? `-${ options.colorScheme }` : '' }.jpg`,
			mimeType: 'image/jpeg',
			data: buffer.buffer.slice(
				buffer.byteOffset,
				buffer.byteOffset + buffer.byteLength
			) as ArrayBuffer,
		};
	} finally {
		fsPromises.unlink( outPath ).catch( () => undefined );
	}
}

function getOwnedWebviewContents( event: IpcMainInvokeEvent, webContentsId: number ): WebContents {
	if ( ! Number.isInteger( webContentsId ) || webContentsId <= 0 ) {
		throw new Error( 'Invalid webview identifier.' );
	}

	const target = webContents.fromId( webContentsId );
	if ( ! target || target.isDestroyed() ) {
		throw new Error( 'Webview is no longer available.' );
	}

	if ( target.hostWebContents?.id !== event.sender.id ) {
		throw new Error( 'Webview does not belong to the current window.' );
	}

	return target;
}

function attachDebuggerIfNeeded( target: WebContents ): boolean {
	if ( target.debugger.isAttached() ) {
		return false;
	}

	target.debugger.attach( '1.3' );
	return true;
}

async function sendDebuggerCommand< T >(
	target: WebContents,
	method: string,
	params?: Record< string, unknown >
): Promise< T > {
	return ( await target.debugger.sendCommand( method, params ) ) as T;
}

export async function setWebviewColorScheme(
	event: IpcMainInvokeEvent,
	webContentsId: number,
	colorScheme: 'light' | 'dark'
): Promise< void > {
	if ( colorScheme !== 'light' && colorScheme !== 'dark' ) {
		throw new Error( 'Unsupported webview color scheme.' );
	}

	const target = getOwnedWebviewContents( event, webContentsId );
	attachDebuggerIfNeeded( target );
	await sendDebuggerCommand( target, 'Emulation.setEmulatedMedia', {
		features: [ { name: 'prefers-color-scheme', value: colorScheme } ],
	} );
}

// Simulates a viewport for the preview webview via the CDP device-metrics
// override that DevTools device mode is built on: the guest lays out at
// `width`×`height` CSS px and Chromium scales the rendered result by `scale`
// to fit the webview, remapping input coordinates to match. `null` returns
// the guest to the webview's natural size.
export async function setWebviewViewport(
	event: IpcMainInvokeEvent,
	webContentsId: number,
	viewport: { width: number; height: number; scale: number; mobile?: boolean } | null
): Promise< void > {
	const target = getOwnedWebviewContents( event, webContentsId );
	attachDebuggerIfNeeded( target );
	if ( ! viewport ) {
		await sendDebuggerCommand( target, 'Emulation.clearDeviceMetricsOverride' );
		return;
	}
	const { width, height, scale, mobile } = viewport;
	const isValidDimension = ( value: number ) =>
		Number.isInteger( value ) && value > 0 && value <= 10000;
	const isValidScale =
		typeof scale === 'number' && Number.isFinite( scale ) && scale > 0 && scale <= 1;
	if ( ! isValidDimension( width ) || ! isValidDimension( height ) || ! isValidScale ) {
		throw new Error( 'Unsupported webview viewport.' );
	}
	await sendDebuggerCommand( target, 'Emulation.setDeviceMetricsOverride', {
		width,
		height,
		// 0 keeps the display's real device pixel ratio.
		deviceScaleFactor: 0,
		// Mobile presets emulate a phone (meta-viewport handling and mobile UA
		// hints), not just a narrow desktop window.
		mobile: mobile === true,
		scale,
	} );
}

// Update a site's theme details and thumbnail. Emit the appropriate IPC events to the renderer
// process.
export async function loadThemeDetails(
	event: IpcMainInvokeEvent,
	id: string,
	emitLoadingEvent = true
): Promise< StartedSiteDetails[ 'themeDetails' ] > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	void captureSiteThumbnail( id, emitLoadingEvent );

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( emitLoadingEvent ) {
		sendIpcEventToRendererWithWindow( parentWindow, 'theme-details-loading', { id } );
	}

	const oldThemePath = server.details.themeDetails?.path;
	const themeDetails = await server.getThemeDetails();
	const hasThemeChanged = themeDetails?.path !== oldThemePath;

	sendIpcEventToRendererWithWindow( parentWindow, 'theme-details-loaded', {
		id,
		details: themeDetails,
	} );

	if ( hasThemeChanged ) {
		await server.persistThemeDetails();
	}

	return themeDetails;
}

// Mirror of loadThemeDetails for the Site Icon: fetch from the running
// site's mu-plugin command and persist the resolved path so the renderer
// can read it back from appdata via getSiteDetails.
export async function loadSiteIcon(
	_event: IpcMainInvokeEvent,
	id: string
): Promise< StartedSiteDetails[ 'siteIconPath' ] > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	const oldIconPath = server.details.siteIconPath;
	const iconPath = await server.getSiteIcon();
	const hasIconChanged = iconPath !== oldIconPath;

	if ( hasIconChanged ) {
		await server.persistSiteIcon();
	}

	return iconPath;
}

export async function getOnboardingData( _event: IpcMainInvokeEvent ): Promise< boolean > {
	const userData = await loadUserData();
	const { onboardingCompleted = false } = userData;
	return onboardingCompleted;
}

export async function saveOnboarding( event: IpcMainInvokeEvent, onboardingCompleted: boolean ) {
	await updateAppdata( { onboardingCompleted } );
}

export async function getBetaFeatures( _event: IpcMainInvokeEvent ): Promise< BetaFeatures > {
	return await getBetaFeaturesFromLib();
}

export async function enableAgenticUi(
	_event: IpcMainInvokeEvent,
	surface: AgenticUiSurface = 'settings'
): Promise< void > {
	await updateBetaFeatureInLib( 'enableAgenticUi', true, surface );
	setAgenticUiEnabled( true );
	// Opting in from classic Studio is the sole way an existing user reaches the
	// agentic workbench, so record it here for the orientation guide's migrating
	// copy. Must land before the renderer reloads below so the guide sees it.
	await recordAgenticUiMigration();
	const mainWindow = await getMainWindow();
	if ( mainWindow && ! mainWindow.isDestroyed() ) {
		await loadMainWindowRenderer( mainWindow );
	}
}

export async function disableAgenticUi(
	_event: IpcMainInvokeEvent,
	surface: AgenticUiSurface = 'settings'
): Promise< void > {
	await updateBetaFeatureInLib( 'enableAgenticUi', false, surface );
	setAgenticUiEnabled( false );
	const mainWindow = await getMainWindow();
	if ( mainWindow && ! mainWindow.isDestroyed() ) {
		await loadMainWindowRenderer( mainWindow );
	}
}

export async function dismissAgenticUiBanner( _event: IpcMainInvokeEvent ): Promise< void > {
	await updateAppdata( { agenticUiBannerDismissed: true } );
}

export async function isAgenticUiBannerDismissed( _event: IpcMainInvokeEvent ): Promise< boolean > {
	const userData = await loadUserData();
	return userData.agenticUiBannerDismissed === true;
}

export { getAppUpdateStatus, installAppUpdate } from 'src/updates';

export async function executeWPCLiInline(
	_event: IpcMainInvokeEvent,
	{
		siteId,
		args,
		skipPluginsAndThemes = false,
	}: {
		siteId: string;
		args: string;
		skipPluginsAndThemes?: boolean;
	}
): Promise< WpCliResult > {
	if ( SiteServer.isDeleted( siteId ) ) {
		return {
			stdout: '',
			stderr: `Cannot execute command on deleted site ${ siteId }`,
			exitCode: 1,
		};
	}
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}
	return server.executeWpCliCommand( args, {
		skipPluginsAndThemes,
	} );
}

/**
 * Scaffolds a structured plugin into the site's wp-content/plugins folder
 * and activates it. Activation works whether the site is running or stopped
 * (wp-cli writes to the on-disk database); a failed activation is reported
 * rather than thrown so the caller still has the scaffolded files.
 */
export async function scaffoldPlugin(
	_event: IpcMainInvokeEvent,
	{ siteId, meta }: { siteId: string; meta: PluginScaffoldMeta }
): Promise< { pluginDir: string; activated: boolean } > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}
	const pluginDir = await scaffoldPluginInSite( server.details.path, meta );
	let activated = false;
	try {
		const result = await server.executeWpCliCommand( `plugin activate ${ meta.slug }`, {
			skipPluginsAndThemes: true,
		} );
		activated = result.exitCode === 0;
	} catch ( error ) {
		console.error( 'Failed to activate scaffolded plugin:', error );
	}
	return { pluginDir, activated };
}

export function getThumbnailData( _event: IpcMainInvokeEvent, id: string ) {
	const path = getSiteThumbnailPath( id );
	return getImageData( path );
}

function promiseExec( command: string, options: ExecOptions = {} ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		exec( command, options, ( error ) => {
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} );
	} );
}

export async function openTerminalAtPath( _event: IpcMainInvokeEvent, targetPath: string ) {
	const platform = process.platform;

	const preferredTerminal = await getUserTerminal();

	// The single funnel for "open in terminal" across both the apps/studio buttons/context-menu and the
	// apps/ui ipc connector — emitting here counts every path once. Fire-and-forget; the wrapper gates
	// opt-out and never throws.
	void recordTracksEvent( TRACKS_EVENTS.SITE_OPEN_IN_TERMINAL, { terminal: preferredTerminal } );

	if ( platform === 'darwin' ) {
		const escapedPath = targetPath.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );
		const bundleIds = {
			warp: 'dev.warp.Warp-Stable',
			ghostty: 'com.mitchellh.ghostty',
			iterm: 'com.googlecode.iterm2',
			terminal: 'com.apple.Terminal',
		};
		return promiseExec( `open -b ${ bundleIds[ preferredTerminal ] } "${ escapedPath }"` );
	} else if ( platform === 'win32' ) {
		const userData = await loadUserData();
		const preferredTerminal = userData.preferredTerminal;
		const defaultShell = process.env.ComSpec || 'cmd.exe';

		if ( preferredTerminal === 'warp' ) {
			const encodedPath = encodeURIComponent( targetPath );
			return promiseExec( `start "" "warp://action/new_tab?path=${ encodedPath }"` );
		}

		// Ensure the Studio CLI bin directory is in the PATH for the spawned terminal.
		// Child processes inherit the environment from the Electron process, which may have
		// been started before the CLI was installed or PATH was updated in the registry.
		const isCliInstalled = await isStudioCliInstalled();
		let env: NodeJS.ProcessEnv | undefined;
		if ( isCliInstalled ) {
			const currentPath = process.env.PATH || '';
			const pathEntries = currentPath.split( ';' ).map( ( p ) => p.toLowerCase() );
			if ( ! pathEntries.includes( STABLE_BIN_DIR_PATH.toLowerCase() ) ) {
				env = { ...process.env };
				delete env.PATH;
				delete env.Path;
				env.PATH = `${ STABLE_BIN_DIR_PATH };${ currentPath }`;
			}
		}

		return promiseExec( `start "Command Prompt" ${ defaultShell }`, {
			cwd: targetPath,
			env,
		} );
	} else if ( platform === 'linux' ) {
		const escapedPath = targetPath.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' );

		// Warp on Linux currently opens at its configured "new session"
		// directory regardless of how it is launched — it ignores
		// `--working-directory`, the `path=` URL scheme query, and the
		// spawn cwd. Tracked upstream in warpdotdev/Warp#4974 and #6357.
		// Best effort: launch with `cwd` set so we benefit if/when upstream
		// adds support, and so a fresh launch (no daemon yet) at least has
		// a chance of inheriting it.
		const launchers: Record<
			SupportedTerminal,
			( ( binary: string ) => { command: string; options?: ExecOptions } ) | null
		> = {
			terminal: ( binary ) => ( {
				command: `"${ binary }" --working-directory="${ escapedPath }"`,
			} ),
			warp: ( binary ) => ( { command: `"${ binary }"`, options: { cwd: targetPath } } ),
			ghostty: ( binary ) => ( {
				command: `"${ binary }" --working-directory="${ escapedPath }"`,
			} ),
			iterm: null,
		};

		const order: SupportedTerminal[] = [ preferredTerminal, 'terminal' ];
		for ( const candidate of order ) {
			const launcher = launchers[ candidate ];
			if ( ! launcher ) {
				continue;
			}
			const binary = await linuxFindTerminalPath( candidate );
			if ( ! binary ) {
				continue;
			}
			const { command, options } = launcher( binary );
			return promiseExec( command, options );
		}

		// Last-resort fallback that preserves prior behavior even if no
		// supported terminal binary is on $PATH.
		return promiseExec( `gnome-terminal --working-directory="${ escapedPath }"` );
	} else {
		console.error( 'Unsupported platform:', platform );
		return;
	}
}

export async function openAppAtPath(
	event: IpcMainInvokeEvent,
	editorKey: SupportedEditor,
	filePath: string,
	otherFiles: string[] = []
): Promise< void > {
	const platform = process.platform;
	const editor = supportedEditorConfig[ editorKey ];
	const allPaths = [ filePath, ...otherFiles ];
	const quotedPaths = allPaths.map( ( p ) => `"${ p }"` ).join( ' ' );

	if ( platform === 'darwin' ) {
		const cmd = `open -b ${ editor.macOSBundleId } ${ quotedPaths }`;
		return promiseExec( cmd );
	}

	if ( platform === 'win32' ) {
		const editorPath = await winFindEditorPath( editorKey );
		if ( ! editorPath ) {
			// Fall back to URL scheme for each path
			for ( const p of allPaths ) {
				openURL( event, editor.url( p ) );
			}
			return;
		}

		return promiseExec( `"${ editorPath }" ${ quotedPaths }` );
	}

	if ( platform === 'linux' ) {
		const editorPath = await linuxFindEditorPath( editorKey );
		if ( ! editorPath ) {
			// Fall back to URL scheme for each path
			for ( const p of allPaths ) {
				openURL( event, editor.url( p ) );
			}
			return;
		}

		return promiseExec( `"${ editorPath }" ${ quotedPaths }` );
	}

	throw new Error( `Platform ${ platform } is not supported` );
}

export function showMessageBox( event: IpcMainInvokeEvent, options: Electron.MessageBoxOptions ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( parentWindow && ! parentWindow.isDestroyed() && ! event.sender.isDestroyed() ) {
		return dialog.showMessageBox( parentWindow, options );
	}
	return dialog.showMessageBox( options );
}

export async function showErrorMessageBox(
	event: IpcMainInvokeEvent,
	{
		title,
		message,
		error,
		showOpenLogs = false,
	}: { title: string; message: string; error?: unknown; showOpenLogs?: boolean }
) {
	let detail = message;

	if ( error ) {
		const simplifiedError = simplifyErrorForDisplay( error );
		// Remove prepended error message added by IPC handler
		const filteredError = simplifiedError?.message?.replace(
			/Error invoking remote method '\w+': Error:/g,
			''
		);
		detail = `${ message }\n\n${ filteredError }`;
	}

	const response = await showMessageBox( event, {
		type: 'error',
		message: title,
		detail,
		buttons: [ ...( showOpenLogs ? [ __( 'Open Studio Logs' ) ] : [] ), __( 'OK' ) ],
	} );

	if ( showOpenLogs && response.response === 0 ) {
		const logFilePath = getLogsFilePath();
		const err = await shell.openPath( logFilePath );
		if ( err ) {
			console.error( `Error opening logs file: ${ logFilePath } ${ err }` );
		}
	}
}

export function showNotification(
	_event: IpcMainInvokeEvent,
	options: Electron.NotificationConstructorOptions
) {
	new Notification( options ).show();
}

export function showChatNotification(
	event: IpcMainInvokeEvent,
	request: ChatNotificationRequest
) {
	showChatNotificationForWindow( BrowserWindow.fromWebContents( event.sender ), request );
}

export async function setupAppMenu(
	_event: IpcMainInvokeEvent,
	config: { needsOnboarding: boolean; isAddSiteVisible?: boolean }
) {
	await setupMenu( config );
}

export async function popupAppMenu(
	_event: IpcMainInvokeEvent,
	position?: { x: number; y: number }
) {
	await popupMenu( position );
}

export async function promptWindowsSpeedUpSites(
	_event: IpcMainInvokeEvent,
	{ skipIfAlreadyPrompted }: { skipIfAlreadyPrompted: boolean }
) {
	await windowsHelpers.promptWindowsSpeedUpSites( { skipIfAlreadyPrompted } );
}

export function setDefaultLocaleData( _event: IpcMainInvokeEvent, locale?: LocaleData ) {
	defaultI18n.setLocaleData( locale );
}

export function resetDefaultLocaleData( _event: IpcMainInvokeEvent ) {
	defaultI18n.resetLocaleData();
}

export function toggleMinWindowWidth(
	event: IpcMainInvokeEvent,
	isSidebarVisible: boolean,
	currentSidebarWidth?: number
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow || parentWindow.isDestroyed() || event.sender.isDestroyed() ) {
		return;
	}
	const sidebarW = currentSidebarWidth ?? SIDEBAR_WIDTH;
	const [ currentWidth, currentHeight ] = parentWindow.getSize();
	const newWidth = Math.max(
		MAIN_MIN_WIDTH,
		isSidebarVisible ? currentWidth - sidebarW : currentWidth + sidebarW
	);
	parentWindow.setSize( newWidth, currentHeight, true );
}

/**
 * Returns the absolute path of a file in the site's directory.
 * Returns null if the file does not exist.
 */
export async function getAbsolutePathFromSite(
	_event: IpcMainInvokeEvent,
	siteId: string,
	relativePath: string
): Promise< string | null > {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	const path = nodePath.join( server.details.path, relativePath );
	return ( await pathExists( path ) ) ? path : null;
}

/**
 * Opens a file in the IDE with the site context.
 * Uses the user's preferred editor, falling back to the first installed editor.
 */
export async function openFileInIDE(
	event: IpcMainInvokeEvent,
	relativePath: string,
	siteId: string
) {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	const filepath = await getAbsolutePathFromSite( event, siteId, relativePath );
	if ( ! filepath ) {
		return;
	}

	const editorKey = await getUserEditor();
	if ( ! editorKey ) {
		return;
	}

	const openSingleFileExceptions = [ { platform: 'darwin', editorKey: 'phpstorm' } ];

	if (
		openSingleFileExceptions.some(
			( f ) => f.platform === process.platform && f.editorKey === editorKey
		)
	) {
		await openAppAtPath( event, editorKey, filepath );
		return;
	}
	// Open site folder and file in a single call
	await openAppAtPath( event, editorKey, server.details.path, [ filepath ] );
}

export async function isImportExportSupported( _event: IpcMainInvokeEvent, siteId: string ) {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	return site.hasSQLitePlugin();
}

export function getDirectorySize( _event: IpcMainInvokeEvent, siteId: string, subdir: string[] ) {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	return calculateDirectorySizeForArchive( nodePath.join( site.details.path, ...subdir ) );
}

export function getFileSize( _event: IpcMainInvokeEvent, siteId: string, filePath: string[] ) {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	const fullPath = nodePath.join( site.details.path, ...filePath );
	try {
		return fs.statSync( fullPath ).size;
	} catch ( error ) {
		// Dangling symlink or unreadable entry. It's skipped when archiving,
		// so count it as zero rather than failing the size check.
		console.warn( `Skipping ${ fullPath }: ${ error }` );
		return 0;
	}
}

export function openCertificate( _event: IpcMainInvokeEvent ) {
	return openCertificateDialog();
}

export async function isCATrusted(): Promise< boolean > {
	return isRootCATrusted();
}

export async function trustCertificate( event: IpcMainInvokeEvent ): Promise< void > {
	const platform = process.platform;
	if ( platform === 'win32' || platform === 'linux' ) {
		try {
			await trustRootCA();
		} catch ( error ) {
			await showErrorMessageBox( event, {
				title: __( 'Certificate Trust Failed' ),
				message: __(
					'Studio was unable to trust the certificate automatically. You may need to trust it manually using certificate manager.'
				),
				showOpenLogs: true,
			} );
		}
	} else {
		await openCertificateDialog();
	}
}

export function showSiteContextMenu(
	event: IpcMainInvokeEvent,
	context: {
		siteId: string;
		isRunning: boolean;
		isLoading: boolean;
		isAddingSite: boolean;
		isAnySiteAdding: boolean;
		isSyncing: boolean;
		finderLabel: string;
		editorLabel: string | null;
		terminalLabel: string;
	}
) {
	const {
		siteId,
		isRunning,
		isLoading,
		isAddingSite,
		isAnySiteAdding,
		isSyncing,
		finderLabel,
		editorLabel,
		terminalLabel,
	} = context;
	const menu = new Menu();

	if ( isRunning ) {
		menu.append(
			new MenuItem( {
				label: __( 'Stop' ),
				enabled: ! isAddingSite,
				click: () => {
					sendIpcEventToRendererWithWindow(
						BrowserWindow.fromWebContents( event.sender ),
						'site-context-menu-action',
						{
							action: 'stop',
							siteId,
						}
					);
				},
			} )
		);
	} else {
		menu.append(
			new MenuItem( {
				label: __( 'Start' ),
				enabled: ! isLoading && ! isAddingSite,
				click: () => {
					sendIpcEventToRendererWithWindow(
						BrowserWindow.fromWebContents( event.sender ),
						'site-context-menu-action',
						{
							action: 'start',
							siteId,
						}
					);
				},
			} )
		);
	}

	menu.append( new MenuItem( { type: 'separator' } ) );

	menu.append(
		new MenuItem( {
			label: __( 'Open site' ),
			enabled: ! isLoading && ! isAddingSite,
			click: () => {
				sendIpcEventToRendererWithWindow(
					BrowserWindow.fromWebContents( event.sender ),
					'site-context-menu-action',
					{
						action: 'open-site',
						siteId,
					}
				);
			},
		} )
	);

	menu.append(
		new MenuItem( {
			label: __( 'WP admin' ),
			enabled: ! isLoading && ! isAddingSite,
			click: () => {
				sendIpcEventToRendererWithWindow(
					BrowserWindow.fromWebContents( event.sender ),
					'site-context-menu-action',
					{
						action: 'open-admin',
						siteId,
					}
				);
			},
		} )
	);

	menu.append( new MenuItem( { type: 'separator' } ) );

	menu.append(
		new MenuItem( {
			label: sprintf(
				/* translators: %s is the name of the file explorer. E.g. "Open in Finder" */
				__( 'Open in %s' ),
				finderLabel
			),
			enabled: ! isAddingSite,
			click: () => {
				sendIpcEventToRendererWithWindow(
					BrowserWindow.fromWebContents( event.sender ),
					'site-context-menu-action',
					{
						action: 'open-finder',
						siteId,
					}
				);
			},
		} )
	);

	if ( editorLabel ) {
		menu.append(
			new MenuItem( {
				label: sprintf(
					/* translators: %s is the name of the editor. E.g. "Open in Cursor" */
					__( 'Open in %s' ),
					editorLabel
				),
				enabled: ! isAddingSite,
				click: () => {
					sendIpcEventToRendererWithWindow(
						BrowserWindow.fromWebContents( event.sender ),
						'site-context-menu-action',
						{
							action: 'open-editor',
							siteId,
						}
					);
				},
			} )
		);
	}

	menu.append(
		new MenuItem( {
			label: sprintf(
				/* translators: %s is the name of the terminal. E.g. "Open in Terminal" */
				__( 'Open in %s' ),
				terminalLabel
			),
			enabled: ! isAddingSite,
			click: () => {
				sendIpcEventToRendererWithWindow(
					BrowserWindow.fromWebContents( event.sender ),
					'site-context-menu-action',
					{
						action: 'open-terminal',
						siteId,
					}
				);
			},
		} )
	);

	menu.append( new MenuItem( { type: 'separator' } ) );

	menu.append(
		new MenuItem( {
			label: __( 'Edit site…' ),
			enabled: ! isAddingSite,
			click: () => {
				sendIpcEventToRendererWithWindow(
					BrowserWindow.fromWebContents( event.sender ),
					'site-context-menu-action',
					{
						action: 'edit-site',
						siteId,
					}
				);
			},
		} )
	);

	menu.append(
		new MenuItem( {
			label: __( 'Duplicate site…' ),
			enabled: ! isLoading && ! isAnySiteAdding,
			click: () => {
				sendIpcEventToRendererWithWindow(
					BrowserWindow.fromWebContents( event.sender ),
					'site-context-menu-action',
					{
						action: 'copy-site',
						siteId,
					}
				);
			},
		} )
	);

	menu.append(
		new MenuItem( {
			label: __( 'Delete site…' ),
			enabled: ! isLoading && ! isAnySiteAdding && ! isSyncing,
			click: () => {
				sendIpcEventToRendererWithWindow(
					BrowserWindow.fromWebContents( event.sender ),
					'site-context-menu-action',
					{
						action: 'delete',
						siteId,
					}
				);
			},
		} )
	);

	const window = BrowserWindow.fromWebContents( event.sender );
	if ( window ) {
		menu.popup( { window } );
	}
}

/**
 * Checks the size of a sync backup file before downloading.
 * Returns the size in bytes.
 */
export async function checkSyncBackupSize(
	event: IpcMainInvokeEvent,
	downloadUrl: string
): Promise< number > {
	return new Promise( ( resolve, reject ) => {
		https
			.get( downloadUrl, { method: 'HEAD' }, ( res ) => {
				if ( res.statusCode !== 200 ) {
					reject( new Error( `Failed to fetch file size: ${ res.statusMessage }` ) );
					return;
				}

				const contentLength = res.headers[ 'content-length' ];
				if ( ! contentLength ) {
					reject( new Error( 'Content-Length header not found' ) );
					return;
				}

				resolve( parseInt( contentLength, 10 ) );
			} )
			.on( 'error', ( error: Error ) => {
				Sentry.captureException( error );
				reject( new Error( `Failed to check backup file size: ${ error.message }` ) );
			} );
	} );
}

export async function isFullscreen( _event: IpcMainInvokeEvent ): Promise< boolean > {
	const window = await getMainWindow();
	return window.isFullScreen();
}

export async function expandWindowForWorkbench( _event: IpcMainInvokeEvent ): Promise< void > {
	const window = await getMainWindow();
	await expandMainWindowForWorkbench( window );
}

export async function getAllCustomDomains(): Promise< string[] > {
	return SiteServer.getAllDetails()
		.map( ( site ) => site.customDomain )
		.filter( ( domain ): domain is string => domain !== undefined );
}

export function comparePaths( event: IpcMainInvokeEvent, path1: string, path2: string ) {
	return arePathsEqual( path1, path2 );
}

export async function listLocalFileTree(
	_event: Electron.IpcMainInvokeEvent,
	siteId: string,
	path: string,
	maxDepth: number = 3,
	currentDepth: number = 0,
	deployIgnore?: Ignore
): Promise< RawDirectoryEntry[] > {
	const server = SiteServer.get( siteId );
	if ( ! server ) throw new Error( 'Site not found' );

	if ( ! deployIgnore ) {
		deployIgnore = await createDeployIgnoreFilter( server.details.path, SYNC_IGNORE_DEFAULTS );
	}

	const fullPath = nodePath.join( server.details.path, path );

	try {
		const entries = await fs.promises.readdir( fullPath, { withFileTypes: true } );
		const result = [];

		for ( const entry of entries ) {
			const itemPath = nodePath.join( path, entry.name ).replace( /\\/g, '/' );

			if ( shouldExcludeFromSync( itemPath, deployIgnore ) ) {
				continue;
			}

			const isDirectory = entry.isDirectory();

			const directoryEntry: RawDirectoryEntry = {
				name: entry.name,
				isDirectory,
				path: itemPath,
			};

			const shouldLimit = shouldLimitDepth( itemPath );
			if ( isDirectory && currentDepth < maxDepth && ! shouldLimit ) {
				try {
					directoryEntry.children = await listLocalFileTree(
						_event,
						siteId,
						itemPath,
						maxDepth,
						currentDepth + 1,
						deployIgnore
					);
				} catch ( childErr ) {
					console.warn( `Failed to load children for ${ itemPath }:`, childErr );
					directoryEntry.children = [];
				}
			}

			result.push( directoryEntry );
		}

		return result;
	} catch ( err ) {
		console.error( `Failed to list raw file tree for path ${ path }:`, err );
		return [];
	}
}

export async function validateBlueprint(
	_event: IpcMainInvokeEvent,
	blueprintJson: Blueprint[ 'blueprint' ]
) {
	return validateBlueprintData( blueprintJson );
}

export async function readBlueprintFile(
	_event: IpcMainInvokeEvent,
	filePath: string
): Promise< Blueprint[ 'blueprint' ] > {
	const allowedDir = nodePath.join( app.getPath( 'temp' ), 'wp-studio-blueprints' );
	const resolvedPath = nodePath.resolve( filePath );

	const normalizedAllowedDir = nodePath.resolve( allowedDir );
	if ( ! resolvedPath.startsWith( normalizedAllowedDir + nodePath.sep ) ) {
		throw new Error( 'Blueprint file path must be within the allowed directory' );
	}

	try {
		const fileContents = await fsPromises.readFile( resolvedPath, 'utf-8' );
		return JSON.parse( fileContents );
	} finally {
		await fsPromises.rm( resolvedPath, { force: true } );
	}
}

export async function extractBlueprintBundle(
	_event: IpcMainInvokeEvent,
	zipFilePath: string
): Promise< ExtractedBlueprintBundle > {
	return extractBlueprintBundleShared( zipFilePath );
}

export async function cleanupBlueprintTempDir(
	_event: IpcMainInvokeEvent,
	tempDir: string
): Promise< void > {
	await cleanupBlueprintTempDirShared( tempDir );
}

export async function setWindowControlVisibility( event: IpcMainInvokeEvent, visible: boolean ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow ) {
		return;
	}

	if ( process.platform === 'darwin' ) {
		parentWindow.setWindowButtonVisibility( visible );
		if ( visible ) {
			parentWindow.setWindowButtonPosition( MACOS_TRAFFIC_LIGHT_POSITION );
		}
	} else if ( process.platform === 'win32' || process.platform === 'linux' ) {
		// Hiding the controls means a fullscreen modal (e.g. Add site) now sits behind them,
		// so the overlay must match its theme-aware `bg-frame` background instead of the chrome.
		parentWindow.setTitleBarOverlay(
			visible ? getTitleBarOverlayOptions() : getFrameTitleBarOverlayOptions()
		);
	}
}

export async function setTitleBarBackdropEffect( event: IpcMainInvokeEvent, enabled: boolean ) {
	void enabled;
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow || ( process.platform !== 'win32' && process.platform !== 'linux' ) ) {
		return;
	}

	parentWindow.setTitleBarOverlay( getTitleBarOverlayOptions() );
}

export async function updateSitesSortOrder(
	event: IpcMainInvokeEvent,
	updates: { siteId: string; sortOrder: number }[]
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();

		for ( const { siteId, sortOrder } of updates ) {
			userData.siteMetadata[ siteId ] = { ...userData.siteMetadata[ siteId ], sortOrder };
		}

		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function getRemoteSessionDaemonStatus(
	_event: IpcMainInvokeEvent
): Promise< RemoteSessionStatus > {
	// Project at the IPC boundary — the renderer only needs the boolean.
	// Keeping `pid` / `pidFile` / `staleFileRemoved` on the main-process side
	// avoids shipping data the UI doesn't read.
	return toRemoteSessionStatus( getDaemonStatus() );
}

export async function startRemoteSessionDaemon(
	_event: IpcMainInvokeEvent
): Promise< StartDaemonResult > {
	// The CLI fires its own `STUDIO_CLI_DOLLY_START` bump when the child
	// process boots. The desktop-side bump captures only bolt-icon clicks, so
	// we can separate UI-driven starts from direct CLI invocations.
	// De-dupe on rapid clicks happens in `useRemoteSessionStatus` via
	// `pendingRunningRef`/`isLoadingRef` before the IPC even fires.
	bumpStat( StatsGroup.STUDIO_APP_DOLLY_START, getPlatformMetric() );
	bumpAggregatedUniqueStat(
		StatsGroup.STUDIO_APP_DOLLY_WKLY_UNQ,
		getPlatformMetric(),
		'weekly'
	).catch( ( err ) => Sentry.captureException( err ) );
	bumpAggregatedUniqueStat(
		StatsGroup.STUDIO_APP_DOLLY_MON_UNQ,
		getPlatformMetric(),
		'monthly'
	).catch( ( err ) => Sentry.captureException( err ) );

	// Treat the CLI as an external program (same pattern as every other
	// CLI-backed operation in Studio): fork it as a child process and let it
	// own the spawn/detach lifecycle. `cli code remote-session start` already
	// does exactly that.
	//
	// `STUDIO_ENABLE_REMOTE_SESSION=true` is required: the CLI gates the entire
	// `code remote-session` subcommand tree behind that env var (see
	// `packages/common/lib/remote-session.ts`). Without it, the spawned child fails with
	// "Unknown arguments: remote-session, start". The `remoteSession` beta
	// feature is the user-facing opt-in, so we lift the CLI gate in the spawned
	// child rather than asking users to set the env var manually.
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand( [ 'code', 'remote-session', 'start' ], {
			output: 'capture',
			env: { STUDIO_ENABLE_REMOTE_SESSION: 'true' },
		} );
		emitter.on( 'success', () => {
			// The CLI returns once the daemon has written its PID file. Re-read it
			// here so the renderer gets a strongly-typed result with the live PID.
			const status = getDaemonStatus();
			if ( status.running && status.pid !== undefined ) {
				resolve( { pid: status.pid, pidFile: status.pidFile } );
				return;
			}
			reject(
				new DaemonStartTimeoutError(
					`Remote-session daemon CLI exited successfully but no live PID file was found at ${ status.pidFile }.`
				)
			);
		} );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}

export async function stopRemoteSessionDaemon(
	_event: IpcMainInvokeEvent
): Promise< StopDaemonResult > {
	bumpStat( StatsGroup.STUDIO_APP_DOLLY_STOP, getPlatformMetric() );

	return new Promise( ( resolve, reject ) => {
		// Same env-flag handshake as `startRemoteSessionDaemon` — without it
		// the CLI doesn't register the `code remote-session` subcommand tree
		// and the spawned child fails with "Unknown argument: stop".
		const [ emitter ] = executeCliCommand( [ 'code', 'remote-session', 'stop' ], {
			output: 'capture',
			env: { STUDIO_ENABLE_REMOTE_SESSION: 'true' },
		} );
		emitter.on( 'success', () => {
			// CLI exit-code 0 indicates the daemon is no longer running (either
			// stopped this invocation or was already gone). The CLI doesn't
			// surface the granular SIGTERM/SIGKILL distinction or the
			// "alreadyStopped" flag over its IPC channel, and the renderer
			// doesn't read those fields anyway, so we just report success.
			// A non-zero exit (e.g. SIGKILL refused) lands in the `failure`
			// branch via CliCommandError.
			resolve( { stopped: true } );
		} );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}
export { showTextContextMenu } from 'src/text-context-menu';
