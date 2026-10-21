import { exec, execFile, ExecOptions } from 'child_process';
import {
	BrowserWindow,
	app,
	clipboard,
	dialog,
	shell,
	webContents,
	type IpcMainInvokeEvent,
	type WebContents,
	SaveDialogOptions,
} from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { validateStudioChatFiles } from '@studio/common/ai/chat-files';
import { validateStudioChatImages } from '@studio/common/ai/chat-images';
import { isAiModelId } from '@studio/common/ai/models';
import { isAiProviderId, providerServesModel } from '@studio/common/ai/providers';
import {
	createHydratedAiSession,
	listHydratedAiSessions,
	loadHydratedAiSession,
	reconcileSessionEnvironment,
	updateHydratedAiSessionMetadata,
} from '@studio/common/ai/sessions/manage';
import { appendModelChangeEntry, appendStudioEntry } from '@studio/common/ai/sessions/store';
import { expandSkillCommandPrompt } from '@studio/common/ai/slash-commands';
import { getAiTracksIdentity } from '@studio/common/ai/tracks-identity';
import { validateStudioVisualAnnotations } from '@studio/common/ai/visual-annotations';
import { DEBUG_LOG_RELATIVE_PATH } from '@studio/common/constants';
import {
	getSkillsStatusForAllSites,
	installSkillToAllSites,
	removeSkillFromAllSites,
	type SkillStatus,
} from '@studio/common/lib/agent-skills';
import {
	downloadAndExtractBlueprintBundle,
	removeBlueprintTempDir,
} from '@studio/common/lib/blueprint-bundle';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { CliCommandError } from '@studio/common/lib/cli-process';
import { stripIpcErrorPrefix } from '@studio/common/lib/error-formatting';
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
import { resolveLocalMediaFile } from '@studio/common/lib/local-media';
import { getAuthenticationUrl, revokeAuthToken } from '@studio/common/lib/oauth';
import { decodePassword } from '@studio/common/lib/passwords';
import { isTracksEventName } from '@studio/common/lib/record-tracks-event';
import {
	ROOT_CA_CERT_PATH,
	hasUntrustedRootCA,
	trustRootCA,
} from '@studio/common/lib/root-ca-trust';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { readAuthToken, updateSharedConfig } from '@studio/common/lib/shared-config';
import {
	getLocalFileSize,
	listLocalFileTree as listSiteFileTree,
} from '@studio/common/lib/sync/local-file-tree';
import { supportedEditorConfig, SupportedEditor } from '@studio/common/lib/user-settings/editor';
import { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import {
	cleanupBlueprintTempDir as cleanupBlueprintTempDirShared,
	extractBlueprintBundle as extractBlueprintBundleShared,
	type ExtractedBlueprintBundle,
} from '@studio/common/sites/blueprint-extract';
import { getSiteEditOptions } from '@studio/common/sites/edit';
import {
	deleteSite as deleteSiteViaCli,
	SiteStartRefusedError,
	startSite,
	stopSite,
} from '@studio/common/sites/lifecycle';
import { updateSiteMetadata } from '@studio/common/sites/metadata';
import {
	designFixesSchema,
	fixSiteDesign,
	readSiteDesign,
	type SiteDesign,
} from '@studio/common/sites/site-design';
import { readSiteIcon, readThemeDetails } from '@studio/common/sites/site-identity';
import { readSite, readSitePath, readSitePaths } from '@studio/common/sites/site-path';
import { __ } from '@wordpress/i18n';
import { DEFAULT_TERMINAL } from 'src/constants';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { setPendingAuthContext } from 'src/lib/auth-tracks-context';
import { bumpStat, getBlueprintMetric, StatsGroup } from 'src/lib/bump-stats';
import {
	extractErrorFromProcessManagerLogs,
	simplifyErrorForDisplay,
} from 'src/lib/error-formatting';
import { getImageData } from 'src/lib/get-image-data';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { setSentryWpcomUserIdMain } from 'src/lib/main-sentry-utils';
import * as oauthClient from 'src/lib/oauth';
import {
	isPhpUserError,
	parsePhpError,
	startErrorRecovery,
	stopErrorRecovery,
} from 'src/lib/php-error-recovery';
import { getAiInstructionsPath } from 'src/lib/server-files-paths';
import { parseWebUrl, shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { getSite, getSites } from 'src/lib/sites';
import {
	recordTracksEvent,
	TRACKS_EVENTS,
	type TracksAuthSource,
	type TracksChannel,
	type TracksSiteCreateFlowType,
	type TracksUiVersion,
} from 'src/lib/tracks';
import { updateSiteUrl } from 'src/lib/update-site-url';
import { getLogsFilePath } from 'src/logging';
import {
	getMainWindow,
	getTitleBarOverlayOptions,
	setAgenticControlsSurface,
	type WindowControlsSurface,
} from 'src/main-window';
import { popupMenu, setupMenu } from 'src/menu';
import {
	answerAgentRun,
	interruptAgentRun,
	listActiveAgentRuns,
	startAgentRun,
} from 'src/modules/ai-agent/run-manager';
import { createSiteViaCli } from 'src/modules/cli/lib/cli-site-creator';
import { editSiteViaCli } from 'src/modules/cli/lib/cli-site-editor';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { isStudioCliInstalled } from 'src/modules/cli/lib/ipc-handlers';
import { STABLE_BIN_DIR_PATH } from 'src/modules/cli/lib/windows-installation-manager';
import { getDefaultSiteDirectory } from 'src/modules/user-settings/lib/ipc-handlers';
import { linuxFindEditorPath } from 'src/modules/user-settings/lib/linux-editor-path';
import { linuxFindTerminalPath } from 'src/modules/user-settings/lib/linux-terminal-path';
import { winFindEditorPath } from 'src/modules/user-settings/lib/win-editor-path';
import { getSiteThumbnailPath } from 'src/storage/paths';
import { updateAppdata, loadUserData } from 'src/storage/user-data';
import { captureSiteThumbnail } from './lib/capture-site-thumbnail';
import type { ActiveAgentRun } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type {
	AiSessionMetadata,
	AiSessionSummary,
	LoadedAiSession,
} from '@studio/common/ai/sessions/types';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';

export {
	isStudioCliInstalled,
	isStudioCliExternallyManaged,
	installStudioCli,
	uninstallStudioCli,
} from 'src/modules/cli/lib/ipc-handlers';

export {
	cancelSyncOperation,
	connectWpcomSites,
	disconnectWpcomSites,
	fetchSyncableWpcomSites,
	getConnectedWpcomSites,
	getHostingPhpVersion,
	getLatestRewindId,
	listRemoteFileTree,
	pullSiteFromLive,
	pushSiteToLive,
} from 'src/modules/sync/lib/ipc-handlers';

export {
	deleteAllSnapshots,
	deletePreviewSite,
	fetchSnapshots,
	publishPreviewSite,
	renamePreviewSite,
} from 'src/modules/preview-site/lib/ipc-handlers';

export {
	getAiSettings,
	getGlobalAgentInstructions,
	getInstalledAppsAndTerminals,
	getOnboardingHints,
	getUserPreferences,
	getWapuuScore,
	saveAnthropicApiKey,
	saveGlobalAgentInstructions,
	saveOnboardingHints,
	saveWapuuScore,
	setUserPreferences,
} from 'src/modules/user-settings/lib/ipc-handlers';

export { importSite, exportSite } from 'src/modules/import-export/lib/ipc-handlers';

export { fetchSiteRest as fetchSiteRestApi } from 'src/lib/wordpress-rest-api';

export async function recordAnalyticsEvent(
	_event: IpcMainInvokeEvent,
	// Typed `string` because this crosses the IPC boundary from the (untrusted) renderer; validated
	// against the known event names below before recording.
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

export async function createAiSession(
	_event: IpcMainInvokeEvent,
	siteId?: string
): Promise< AiSessionSummary > {
	const sessionsRoot = getSessionsDirectory();
	const site = siteId ? await readSite( siteId ) : undefined;
	if ( siteId && ! site ) {
		throw new Error( `Site not found: ${ siteId }` );
	}

	const summary = await createHydratedAiSession( sessionsRoot, {
		site: site ? { id: site.id, name: site.name, path: site.path } : undefined,
	} );

	// Fires from Main, not the CLI: sessions are created in-process.
	// `studio ui` emits the same event from its own session route.
	await recordTracksEvent( TRACKS_EVENTS.CODE_SESSION_CREATED, {
		...getAiTracksIdentity( summary.id ),
		has_site: Boolean( site ),
	} );

	return summary;
}

export async function updateAiSessionMetadata(
	_event: IpcMainInvokeEvent,
	sessionIdOrPrefix: string,
	patch: AiSessionMetadata
): Promise< AiSessionSummary > {
	return updateHydratedAiSessionMetadata( getSessionsDirectory(), sessionIdOrPrefix, patch );
}

export async function continueAiSession(
	event: IpcMainInvokeEvent,
	sessionId: string,
	prompt: string,
	options: {
		displayMessage?: string;
		images?: StudioChatImage[];
		files?: StudioChatFileAttachment[];
		visualAnnotations?: unknown;
	} = {}
): Promise< { runId: string } > {
	if ( ! ( await oauthClient.isAuthenticated() ) ) {
		throw new Error( __( 'WordPress.com login required. Log in to use Studio Code.' ) );
	}

	await reconcileSessionEnvironment( getSessionsDirectory(), sessionId );
	const images = validateStudioChatImages( options.images );
	const files = validateStudioChatFiles( options.files );
	const visualAnnotations = validateStudioVisualAnnotations( options.visualAnnotations );
	return startAgentRun( {
		sessionId,
		prompt: expandSkillCommandPrompt( prompt ),
		displayMessage: options.displayMessage,
		images,
		files,
		visualAnnotations,
		webContents: event.sender,
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

export async function setAiSessionProvider(
	_event: IpcMainInvokeEvent,
	sessionId: string,
	provider: string,
	model: string
): Promise< void > {
	if ( ! isAiProviderId( provider ) ) {
		throw new Error( `Unknown AI provider: ${ provider }` );
	}
	if ( ! isAiModelId( model ) || ! providerServesModel( provider, model ) ) {
		throw new Error( `Model ${ model } is not served by provider ${ provider }` );
	}
	await appendStudioEntry( getSessionsDirectory(), sessionId, 'studio.session_context', {
		provider,
		model,
	} );
}

export interface SetSessionEnvironmentResult {
	environment: 'local' | 'live';
	url?: string;
	wpcomSiteId?: number;
	summary: AiSessionSummary;
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

export async function getWordPressSkillsStatusAllSites(
	_event: IpcMainInvokeEvent
): Promise< SkillStatus[] > {
	return getSkillsStatusForAllSites();
}

export async function installWordPressSkillsToAllSites(
	_event: IpcMainInvokeEvent,
	options: { skillId: string; overwrite?: boolean }
): Promise< void > {
	await installSkillToAllSites( getAiInstructionsPath(), options.skillId, options.overwrite );
}

export async function removeWordPressSkillFromAllSites(
	_event: IpcMainInvokeEvent,
	skillId: string
): Promise< void > {
	await removeSkillFromAllSites( skillId );
}

const DEBUG_LOG_MAX_LINES = 50;
const PROCESS_MANAGER_HOME =
	process.env.STUDIO_PROCESS_MANAGER_HOME ?? nodePath.join( os.homedir(), '.studio', 'daemon' );

function readWordPressDebugLog( sitePath: string ): string[] | undefined {
	const debugLogPath = nodePath.join( sitePath, DEBUG_LOG_RELATIVE_PATH );
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
	return getSites();
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
		const site = await createSiteViaCli( {
			path,
			name: siteName,
			wpVersion,
			phpVersion,
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
		} );

		// An uploaded bundle is kept on failure, so the user can retry without uploading it again.
		if ( blueprint?.filePath ) {
			const blueprintDir = nodePath.dirname( nodePath.resolve( blueprint.filePath ) );
			await removeBlueprintTempDir( blueprintDir ).catch( () => {} );
		}

		return site;
	} catch ( error ) {
		const contexts: Record< string, Record< string, unknown > > = {
			site: {
				hasBlueprint: !! blueprint,
				wpVersion,
				phpVersion,
				hasCustomDomain: !! customDomain,
				httpsEnabled: !! enableHttps,
			},
		};

		const debugLog = readWordPressDebugLog( path );
		if ( debugLog && debugLog.length > 0 ) {
			contexts.debugLog = { entries: debugLog };
		}

		const processManagerLogs = readProcessManagerLogs( siteId );
		if ( processManagerLogs.stdout && processManagerLogs.stdout.length > 0 ) {
			contexts.processLogs = { entries: processManagerLogs.stdout };
		}
		if ( processManagerLogs.stderr && processManagerLogs.stderr.length > 0 ) {
			contexts.processErrors = { entries: processManagerLogs.stderr };
		}

		Sentry.captureException( error, {
			tags: {
				provider: 'cli',
			},
			contexts,
		} );

		// If the error message is generic, try to surface a more useful message from
		// the process manager logs. The detailed error is often captured in stdout
		// (e.g. Blueprint execution errors).
		const logErrorMessage = extractErrorFromProcessManagerLogs( processManagerLogs );
		if ( logErrorMessage ) {
			throw new Error( logErrorMessage );
		}

		throw error instanceof CliCommandError && error.lastErrorMessage
			? new Error( error.lastErrorMessage )
			: error;
	} finally {
		if ( bundleTempDir ) {
			await removeBlueprintTempDir( bundleTempDir ).catch( () => {} );
		}
	}
}

// Update a site's details (name, custom domain, PHP version, etc) with the `site set` CLI command.
export async function updateSite(
	event: IpcMainInvokeEvent,
	updatedSite: SiteDetails,
	wpVersion?: string
): Promise< void > {
	const site = await getSite( updatedSite.id );
	if ( ! site ) {
		throw new Error( `Site not found: ${ updatedSite.id }` );
	}

	const options = getSiteEditOptions( site, updatedSite, wpVersion );
	if ( Object.keys( options ).length > 2 ) {
		await editSiteViaCli( options );
	}
}

export async function startServer( event: IpcMainInvokeEvent, id: string ): Promise< void > {
	const site = await getSite( id );
	if ( ! site ) {
		return;
	}

	// Release the port held by any active PHP-error recovery before (re)starting the real server,
	// otherwise the recovery error server still bound to the site's port causes EADDRINUSE.
	await stopErrorRecovery( id );

	const start = () => startSite( executeCliCommand, site.path );
	try {
		console.log( `Starting server for '${ site.name }'` );
		await start();
	} catch ( error ) {
		// Too many running sites or a WordPress update in progress: expected, not a bug — skip Sentry
		if ( error instanceof SiteStartRefusedError ) {
			throw error;
		}

		// A fatal error in the user's own PHP (theme/plugin) code stops WordPress from booting.
		// Rather than failing the start, serve the parsed PHP error on the site's port and watch for
		// the fix so the site self-recovers. This is user code, not a Studio bug, so skip Sentry.
		if ( isPhpUserError( error ) ) {
			const processManagerLogs = readProcessManagerLogs( id );
			const logContent = [
				...( processManagerLogs.stdout ?? [] ),
				...( processManagerLogs.stderr ?? [] ),
			].join( '\n' );
			const errorMessage = parsePhpError( logContent );

			try {
				await startErrorRecovery( site, errorMessage, readProcessManagerLogs, start );
				console.log( `[PHP Recovery - ${ id }] Serving PHP error page on port ${ site.port }` );
				const url = `http://localhost:${ site.port }`;
				void sendIpcEventToRenderer( 'site-event', {
					event: SITE_EVENTS.UPDATED,
					siteId: id,
					site: {
						id,
						name: site.name,
						path: site.path,
						port: site.port,
						url,
						phpVersion: site.phpVersion,
					},
					running: true,
				} );
				// Refresh the thumbnail so it shows the error page instead of a stale capture.
				void captureSiteThumbnail( { id, url } );
				return;
			} catch ( recoveryError ) {
				console.error( `[PHP Recovery - ${ id }] Failed to start recovery:`, recoveryError );
				// Fall through to report the original error.
			}
		}

		const contexts: Record< string, Record< string, unknown > > = {
			server: {
				running: site.running,
				phpVersion: site.phpVersion,
				port: site.port,
				hasCustomDomain: !! site.customDomain,
				httpsEnabled: !! site.enableHttps,
			},
		};

		const debugLog = readWordPressDebugLog( site.path );
		if ( debugLog && debugLog.length > 0 ) {
			contexts.debugLog = { entries: debugLog };
		}

		const processManagerLogs = readProcessManagerLogs( id );
		if ( processManagerLogs.stdout && processManagerLogs.stdout.length > 0 ) {
			contexts.processLogs = { entries: processManagerLogs.stdout };
		}
		if ( processManagerLogs.stderr && processManagerLogs.stderr.length > 0 ) {
			contexts.processErrors = { entries: processManagerLogs.stderr };
		}

		Sentry.captureException( error, {
			tags: {
				provider: 'cli',
			},
			contexts,
		} );

		throw error;
	}

	console.log( `Server started for '${ site.name }'` );
}

export async function stopServer( event: IpcMainInvokeEvent, id: string ): Promise< void > {
	const sitePath = await readSitePath( id );
	if ( ! sitePath ) {
		return;
	}

	await stopErrorRecovery( id );
	console.log( 'Stopping server with ID', id );
	try {
		await stopSite( executeCliCommand, sitePath );
	} catch ( error ) {
		console.error( error );
	}
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

export async function deleteSite( event: IpcMainInvokeEvent, id: string, deleteFiles = false ) {
	const sitePath = await readSitePath( id );
	console.log( 'Deleting site', id );
	if ( ! sitePath ) {
		throw new Error( 'Site not found.' );
	}
	await deleteSiteViaCli( executeCliCommand, sitePath, deleteFiles );
}

export async function copySite(
	event: IpcMainInvokeEvent,
	sourceSiteId: string,
	newSiteId: string,
	siteName: string
): Promise< SiteDetails > {
	const sourceSite = await getSite( sourceSiteId );
	if ( ! sourceSite ) {
		throw new Error( 'Source site not found.' );
	}

	const defaultSiteDirectory = await getDefaultSiteDirectory();
	const finalSitePath = nodePath.join( defaultSiteDirectory, sanitizeFolderName( siteName ) );

	console.log( `Copying site '${ sourceSite.name }' to '${ siteName }'` );

	await recursiveCopyDirectory( sourceSite.path, finalSitePath );

	const sourceThumbnailPath = getSiteThumbnailPath( sourceSiteId );
	const newThumbnailPath = getSiteThumbnailPath( newSiteId );
	if ( fs.existsSync( sourceThumbnailPath ) ) {
		await fs.promises.copyFile( sourceThumbnailPath, newThumbnailPath );
	}

	const site = await createSiteViaCli( {
		path: finalSitePath,
		name: siteName,
		siteId: newSiteId,
		phpVersion: sourceSite.phpVersion,
		fileAccess: sourceSite.fileAccess,
		adminUsername: sourceSite.adminUsername,
		adminPassword: sourceSite.adminPassword
			? decodePassword( sourceSite.adminPassword )
			: undefined,
		adminEmail: sourceSite.adminEmail,
		noStart: true,
		flowType: 'duplicate',
	} );

	// The copy keeps the source site's siteurl, so point it at the new port
	await updateSiteUrl( site, `http://localhost:${ site.port }` );

	return site;
}

export async function authenticate(
	event: IpcMainInvokeEvent,
	isSignup = false,
	source: TracksAuthSource = 'unknown'
) {
	// The result arrives later, in a deep link that knows neither of these. Stash them for it.
	setPendingAuthContext( source, isSignup ? 'new' : 'existing' );

	const locale = await getUserLocaleWithFallback();
	const authUrl = isSignup ? oauthClient.getSignUpUrl( locale ) : getAuthenticationUrl( locale );
	void shellOpenExternalWrapper( authUrl );
}

export async function getAuthenticationToken() {
	return oauthClient.getAuthenticationToken();
}

export async function clearAuthenticationToken() {
	const token = await readAuthToken();
	if ( token ) {
		// Best-effort: logging out offline still signs out locally.
		await revokeAuthToken( token.accessToken ).catch( () => undefined );
	}
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
	const site = await getSite( id );
	if ( ! site ) {
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
	const usingLandingPage = ! relativeURL && !! site.landingPage;
	const targetPath = relativeURL || site.landingPage || '';
	let url = new URL( targetPath, site.url );
	// Blueprint landing pages may point at admin screens; force auto-login so
	// users don't get bounced to the login page. This matches Playground's
	// "always-logged-in sandbox" behavior for Blueprint-imported sites.
	if ( autoLogin || usingLandingPage ) {
		const autoLoginUrl = new URL( '/studio-auto-login', site.url );
		autoLoginUrl.searchParams.append( 'redirect_to', url.toString() );
		url = autoLoginUrl;
	}

	void shellOpenExternalWrapper( url.toString() );
}

// Only web URLs: other schemes would launch whatever app handles them.
export function openURL( event: IpcMainInvokeEvent, url: string ) {
	const webUrl = parseWebUrl( url );
	if ( webUrl ) {
		void shellOpenExternalWrapper( webUrl );
	}
}

export function copyText( event: IpcMainInvokeEvent, text: string ) {
	return clipboard.writeText( text );
}

export function getAppGlobals(): AppGlobals {
	return {
		platform: process.platform,
		appName: app.name,
		appVersion: app.getVersion(),
		isWindowsStore: process.windowsStore ?? false,
	};
}

export async function getWpVersion( _event: IpcMainInvokeEvent, id: string ) {
	const sitePath = await readSitePath( id );
	return sitePath ? getWordPressVersion( sitePath ) : '-';
}

const activeThemeSlug = ( sitePath: string ) => async () =>
	( await readThemeDetails( executeCliCommand, sitePath ).catch( () => undefined ) )?.slug;

export async function getSiteDesign(
	_event: IpcMainInvokeEvent,
	id: string
): Promise< SiteDesign | null > {
	const sitePath = await readSitePath( id );
	return sitePath ? readSiteDesign( sitePath, activeThemeSlug( sitePath ) ) : null;
}

export async function fixSiteDesignDrift(
	_event: IpcMainInvokeEvent,
	id: string,
	fixes: unknown
): Promise< SiteDesign | null > {
	const sitePath = await readSitePath( id );
	return sitePath
		? fixSiteDesign( sitePath, activeThemeSlug( sitePath ), designFixesSchema.parse( fixes ) )
		: null;
}

export async function getIsMultisite( _event: IpcMainInvokeEvent, id: string ) {
	const sitePath = await readSitePath( id );
	return sitePath ? isMultisite( sitePath ) : false;
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

export async function openStudioLogs( _event: IpcMainInvokeEvent ) {
	await shell.openPath( getLogsFilePath() );
}

export async function readLocalMediaFile(
	_event: IpcMainInvokeEvent,
	path: string
): Promise< { name: string; mimeType: string; data: ArrayBuffer } > {
	const media = await resolveLocalMediaFile( path, [
		getSessionsDirectory(),
		...( await readSitePaths() ),
	] );
	if ( ! media ) {
		throw new Error( 'Local media file not found.' );
	}
	const buffer = await fsPromises.readFile( media.path );
	return {
		name: nodePath.basename( path ),
		mimeType: media.mimeType,
		data: buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength
		) as ArrayBuffer,
	};
}

export async function getSiteIcon(
	_event: IpcMainInvokeEvent,
	id: string
): Promise< string | null > {
	return readSiteIcon( executeCliCommand, await requireSitePath( id ) );
}

export async function getOnboardingData( _event: IpcMainInvokeEvent ): Promise< boolean > {
	const userData = await loadUserData();
	const { onboardingCompleted = false } = userData;
	return onboardingCompleted;
}

export async function saveOnboarding( event: IpcMainInvokeEvent, onboardingCompleted: boolean ) {
	const { onboardingCompleted: previous = false } = await loadUserData();
	await updateAppdata( { onboardingCompleted } );

	// Only on a real transition — a re-save must not look like a second user finishing onboarding.
	if ( onboardingCompleted && ! previous ) {
		await recordTracksEvent( TRACKS_EVENTS.ONBOARDING_COMPLETE, {
			// Whether they leave onboarding with an account, which is what "skipped" really meant.
			authenticated: await oauthClient.isAuthenticated(),
		} );
	}
}

export { getAppUpdateStatus, installAppUpdate } from 'src/updates';

export function getThumbnailData( _event: IpcMainInvokeEvent, id: string ) {
	const path = getSiteThumbnailPath( id );
	return getImageData( path );
}

function promiseExec( command: string, options: ExecOptions = {} ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		exec( command, options, ( error ) => ( error ? reject( error ) : resolve() ) );
	} );
}

// Paths travel as arguments rather than through a shell, so a folder name can't run anything.
function promiseExecFile(
	file: string,
	args: string[],
	options: ExecOptions = {}
): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		execFile( file, args, options, ( error ) => ( error ? reject( error ) : resolve() ) );
	} );
}

export async function openTerminalAtPath( _event: IpcMainInvokeEvent, targetPath: string ) {
	const platform = process.platform;

	const preferredTerminal = ( await loadUserData() ).preferredTerminal || DEFAULT_TERMINAL;

	// The single funnel for "open in terminal" across both the apps/studio buttons/context-menu and the
	// apps/ui ipc connector — emitting here counts every path once. Fire-and-forget; the wrapper gates
	// opt-out and never throws.
	void recordTracksEvent( TRACKS_EVENTS.SITE_OPEN_IN_TERMINAL, { terminal: preferredTerminal } );

	if ( platform === 'darwin' ) {
		const bundleIds = {
			warp: 'dev.warp.Warp-Stable',
			ghostty: 'com.mitchellh.ghostty',
			iterm: 'com.googlecode.iterm2',
			terminal: 'com.apple.Terminal',
		};
		return promiseExecFile( 'open', [ '-b', bundleIds[ preferredTerminal ], targetPath ] );
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
		// Warp on Linux currently opens at its configured "new session"
		// directory regardless of how it is launched — it ignores
		// `--working-directory`, the `path=` URL scheme query, and the
		// spawn cwd. Tracked upstream in warpdotdev/Warp#4974 and #6357.
		// Best effort: launch with `cwd` set so we benefit if/when upstream
		// adds support, and so a fresh launch (no daemon yet) at least has
		// a chance of inheriting it.
		const launchers: Record< SupportedTerminal, { args: string[]; options?: ExecOptions } | null > =
			{
				terminal: { args: [ `--working-directory=${ targetPath }` ] },
				warp: { args: [], options: { cwd: targetPath } },
				ghostty: { args: [ `--working-directory=${ targetPath }` ] },
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
			return promiseExecFile( binary, launcher.args, launcher.options );
		}

		// Last-resort fallback that preserves prior behavior even if no
		// supported terminal binary is on $PATH.
		return promiseExecFile( 'gnome-terminal', [ `--working-directory=${ targetPath }` ] );
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

	if ( platform === 'darwin' ) {
		return promiseExecFile( 'open', [ '-b', editor.macOSBundleId, ...allPaths ] );
	}

	if ( platform === 'win32' ) {
		const editorPath = await winFindEditorPath( editorKey );
		if ( ! editorPath ) {
			// Fall back to URL scheme for each path
			for ( const p of allPaths ) {
				void shellOpenExternalWrapper( editor.url( p ) );
			}
			return;
		}

		return promiseExecFile( editorPath, allPaths );
	}

	if ( platform === 'linux' ) {
		const editorPath = await linuxFindEditorPath( editorKey );
		if ( ! editorPath ) {
			// Fall back to URL scheme for each path
			for ( const p of allPaths ) {
				void shellOpenExternalWrapper( editor.url( p ) );
			}
			return;
		}

		return promiseExecFile( editorPath, allPaths );
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
		const filteredError = stripIpcErrorPrefix( simplifiedError?.message ?? '' );
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

export async function setupAppMenu() {
	await setupMenu();
}

export async function popupAppMenu(
	_event: IpcMainInvokeEvent,
	position?: { x: number; y: number }
) {
	await popupMenu( position );
}

export async function ensureMinWindowWidth(
	event: IpcMainInvokeEvent,
	minimumWidth: number
): Promise< number | null > {
	if ( ! Number.isFinite( minimumWidth ) || minimumWidth <= 0 ) {
		return null;
	}
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow || parentWindow.isDestroyed() || event.sender.isDestroyed() ) {
		return null;
	}
	// Measure and resize the content area, not the whole window. The renderer's
	// responsive math is entirely in CSS pixels (`window.innerWidth`); on Windows
	// and Linux the window frame makes that differ from the outer window size, so
	// growing (and reporting) the content width is what keeps the two in sync.
	const [ currentWidth, currentHeight ] = parentWindow.getContentSize();
	const nextWidth = Math.ceil( minimumWidth );
	if ( currentWidth < nextWidth ) {
		parentWindow.setContentSize( nextWidth, currentHeight );
	}
	return parentWindow.getContentSize()[ 0 ];
}

async function requireSitePath( siteId: string ): Promise< string > {
	const sitePath = await readSitePath( siteId );
	if ( ! sitePath ) {
		throw new Error( 'Site not found.' );
	}
	return sitePath;
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
	const path = nodePath.join( await requireSitePath( siteId ), relativePath );
	return ( await pathExists( path ) ) ? path : null;
}

export async function getDirectorySize(
	_event: IpcMainInvokeEvent,
	siteId: string,
	subdir: string[]
) {
	return calculateDirectorySizeForArchive(
		nodePath.join( await requireSitePath( siteId ), ...subdir )
	);
}

export async function getFileSize(
	_event: IpcMainInvokeEvent,
	siteId: string,
	filePath: string[]
) {
	return getLocalFileSize( nodePath.join( await requireSitePath( siteId ), ...filePath ) );
}

export async function isCATrusted(): Promise< boolean > {
	return ! ( await hasUntrustedRootCA() );
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
		shell.showItemInFolder( ROOT_CA_CERT_PATH );
	}
}

export async function isFullscreen( _event: IpcMainInvokeEvent ): Promise< boolean > {
	const window = await getMainWindow();
	return window.isFullScreen();
}

export function comparePaths( event: IpcMainInvokeEvent, path1: string, path2: string ) {
	return arePathsEqual( path1, path2 );
}

export async function listLocalFileTree(
	_event: IpcMainInvokeEvent,
	siteId: string,
	path: string,
	maxDepth: number = 3
): Promise< RawDirectoryEntry[] > {
	return listSiteFileTree( await requireSitePath( siteId ), path, maxDepth );
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

// Repaints the window-controls overlay for whichever surface it is sitting on;
// only the renderer knows when a full-window page is covering the chrome.
export async function setWindowControlsSurface(
	event: IpcMainInvokeEvent,
	surface: WindowControlsSurface
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow || ( process.platform !== 'win32' && process.platform !== 'linux' ) ) {
		return;
	}
	setAgenticControlsSurface( surface );
	parentWindow.setTitleBarOverlay( getTitleBarOverlayOptions() );
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
	await updateSiteMetadata(
		Object.fromEntries( updates.map( ( { siteId, sortOrder } ) => [ siteId, { sortOrder } ] ) )
	);
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

export async function clearWebviewCache(
	event: IpcMainInvokeEvent,
	webContentsId: number
): Promise< void > {
	await getOwnedWebviewContents( event, webContentsId ).session.clearCache();
}

export async function getWebviewNavigationHistory(
	event: IpcMainInvokeEvent,
	webContentsId: number
): Promise< {
	activeIndex: number;
	entries: { index: number; title: string; url: string }[];
} > {
	const history = getOwnedWebviewContents( event, webContentsId ).navigationHistory;
	return {
		activeIndex: history.getActiveIndex(),
		entries: history.getAllEntries().map( ( entry, index ) => ( {
			index,
			title: entry.title,
			url: entry.url,
		} ) ),
	};
}

export async function goToWebviewNavigationHistoryEntry(
	event: IpcMainInvokeEvent,
	webContentsId: number,
	index: number
): Promise< void > {
	getOwnedWebviewContents( event, webContentsId ).navigationHistory.goToIndex( index );
}

export { showTextContextMenu } from 'src/text-context-menu';
