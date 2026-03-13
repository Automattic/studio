import { exec, ExecOptions } from 'child_process';
import {
	BrowserWindow,
	Menu,
	MenuItem,
	app,
	clipboard,
	dialog,
	shell,
	type IpcMainInvokeEvent,
	Notification,
	SaveDialogOptions,
} from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import https from 'node:https';
import os from 'os';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { bumpStat } from '@studio/common/lib/bump-stat';
import { parseCliError, errorMessageContains } from '@studio/common/lib/cli-error';
import {
	calculateDirectorySizeForArchive,
	isWordPressDirectory,
	arePathsEqual,
	isEmptyDir,
	pathExists,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { generateNumberedName, generateSiteName } from '@studio/common/lib/generate-site-name';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { decodePassword, encodePassword } from '@studio/common/lib/passwords';
import { portFinder } from '@studio/common/lib/port-finder';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { isWordPressDevVersion } from '@studio/common/lib/wordpress-version-utils';
import { Snapshot } from '@studio/common/types/snapshot';
import { StatsGroup, StatsMetric } from '@studio/common/types/stats';
import { __, sprintf, LocaleData, defaultI18n } from '@wordpress/i18n';
import { MACOS_TRAFFIC_LIGHT_POSITION, MAIN_MIN_WIDTH, SIDEBAR_WIDTH } from 'src/constants';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { getBetaFeatures as getBetaFeaturesFromLib } from 'src/lib/beta-features';
import { getImporterMetric, getBlueprintMetric } from 'src/lib/bump-stats/lib';
import {
	openCertificate as openCertificateDialog,
	isRootCATrusted,
	trustRootCA,
} from 'src/lib/certificate-manager';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import { buildFeatureFlags } from 'src/lib/feature-flags';
import { getImageData } from 'src/lib/get-image-data';
import { exportBackup } from 'src/lib/import-export/export/export-manager';
import { ExportOptions } from 'src/lib/import-export/export/types';
import { ImportExportEventData } from 'src/lib/import-export/handle-events';
import { defaultImporterOptions, importBackup } from 'src/lib/import-export/import/import-manager';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import * as oauthClient from 'src/lib/oauth';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import * as windowsHelpers from 'src/lib/windows-helpers';
import { setupWordPressFilesOnly } from 'src/lib/wordpress-setup';
import { getLogsFilePath, writeLogToFile, type LogLevel } from 'src/logging';
import { getMainWindow } from 'src/main-window';
import { popupMenu, setupMenu } from 'src/menu';
import {
	DEFAULT_AGENT_INSTRUCTIONS,
	type InstructionFileType,
} from 'src/modules/agent-instructions/constants';
import {
	getAllInstructionFilesStatus,
	installInstructionFile,
	type InstructionFileStatus,
} from 'src/modules/agent-instructions/lib/instructions';
import { editSiteViaCli, EditSiteOptions } from 'src/modules/cli/lib/cli-site-editor';
import { isStudioCliInstalled } from 'src/modules/cli/lib/ipc-handlers';
import { STABLE_BIN_DIR_PATH } from 'src/modules/cli/lib/windows-installation-manager';
import { shouldExcludeFromSync, shouldLimitDepth } from 'src/modules/sync/lib/tree-utils';
import { supportedEditorConfig, SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { getUserEditor, getUserTerminal } from 'src/modules/user-settings/lib/ipc-handlers';
import { winFindEditorPath } from 'src/modules/user-settings/lib/win-editor-path';
import { SiteServer, stopAllServers as triggerStopAllServers } from 'src/site-server';
import { DEFAULT_SITE_PATH, getSiteThumbnailPath } from 'src/storage/paths';
import {
	loadUserData,
	lockAppdata,
	saveUserData,
	unlockAppdata,
	updateAppdata,
} from 'src/storage/user-data';
import { Blueprint } from 'src/stores/wpcom-api';
import type { RawDirectoryEntry } from 'src/modules/sync/types';
import type { WpCliResult } from 'src/site-server';

export {
	isStudioCliInstalled,
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
	getConnectedWpcomSites,
	pauseSyncUpload,
	pushArchive,
	removeSyncBackup,
	resumeSyncUpload,
	updateConnectedWpcomSites,
	updateSingleConnectedWpcomSite,
} from 'src/modules/sync/lib/ipc-handlers';

export {
	createSnapshot,
	deleteSnapshot,
	updateSnapshot,
} from 'src/modules/preview-site/lib/ipc-handlers';

export {
	getInstalledAppsAndTerminals,
	getUserEditor,
	getUserLocale,
	getUserTerminal,
	saveUserEditor,
	saveUserLocale,
	saveUserTerminal,
	showUserSettings,
} from 'src/modules/user-settings/lib/ipc-handlers';

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
	return installInstructionFile(
		server.details.path,
		fileType,
		DEFAULT_AGENT_INSTRUCTIONS,
		overwrite
	);
}

const DEBUG_LOG_MAX_LINES = 50;
const PM2_HOME = nodePath.join( os.homedir(), '.studio', 'pm2' );
const DEFAULT_ENCODED_PASSWORD = encodePassword( 'password' );

function readLastLines( filePath: string, maxLines: number ): string[] | undefined {
	try {
		if ( ! fs.existsSync( filePath ) ) {
			return undefined;
		}
		const content = fs.readFileSync( filePath, 'utf-8' );
		const lines = content.split( '\n' ).filter( ( line ) => line.trim() );
		return lines.slice( -maxLines );
	} catch {
		return undefined;
	}
}

function readWordPressDebugLog( sitePath: string ): string[] | undefined {
	const debugLogPath = nodePath.join( sitePath, 'wp-content', 'debug.log' );
	return readLastLines( debugLogPath, DEBUG_LOG_MAX_LINES );
}

function readPm2Logs( siteId: string ): { stdout?: string[]; stderr?: string[] } {
	const logsDir = nodePath.join( PM2_HOME, 'logs' );
	const stdoutPath = nodePath.join( logsDir, `studio-site-${ siteId }-out.log` );
	const stderrPath = nodePath.join( logsDir, `studio-site-${ siteId }-error.log` );

	return {
		stdout: readLastLines( stdoutPath, DEBUG_LOG_MAX_LINES ),
		stderr: readLastLines( stderrPath, DEBUG_LOG_MAX_LINES ),
	};
}

function mergeSiteDetailsWithRunningDetails( sites: SiteDetails[] ): SiteDetails[] {
	return sites.map( ( site ) => {
		const server = SiteServer.get( site.id );
		if ( server ) {
			return server.details;
		}
		return site;
	} );
}

export async function getSiteDetails( _event: IpcMainInvokeEvent ): Promise< SiteDetails[] > {
	const userData = await loadUserData();

	const { sites } = userData;

	// Ensure we have an instance of a server for each site we know about
	for ( const site of sites ) {
		if ( ! SiteServer.get( site.id ) && ! site.running ) {
			SiteServer.register( site );
		}
	}

	return mergeSiteDetailsWithRunningDetails( sites );
}

export async function getXdebugEnabledSite(
	_event: IpcMainInvokeEvent
): Promise< SiteDetails | null > {
	const userData = await loadUserData();
	const { sites } = userData;
	const xdebugSite = sites.find( ( site ) => site.enableXdebug );
	if ( ! xdebugSite ) {
		return null;
	}
	return mergeSiteDetailsWithRunningDetails( [ xdebugSite ] )[ 0 ] || null;
}

export async function importSite(
	event: IpcMainInvokeEvent,
	{ id, backupFile }: { id: string; backupFile: BackupArchiveInfo }
): Promise< SiteDetails > {
	const site = SiteServer.get( id );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	try {
		if ( ! isWordPressDirectory( site.details.path ) ) {
			await setupWordPressFilesOnly( site.details.path );
		}

		const onEvent = ( data: ImportExportEventData ) => {
			const parentWindow = BrowserWindow.fromWebContents( event.sender );
			sendIpcEventToRendererWithWindow( parentWindow, 'on-import', data, id );
		};
		const result = await importBackup( backupFile, site.details, onEvent, defaultImporterOptions );

		bumpStat( StatsGroup.STUDIO_IMPORT, getImporterMetric( result.importerType ) );

		if ( result?.meta?.phpVersion ) {
			site.details.phpVersion = result.meta.phpVersion;
		}

		// Clear blueprint so it doesn't overwrite imported data on first start
		site.meta.blueprint = undefined;

		return site.details;
	} catch ( e ) {
		bumpStat( StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE );
		// Don't report validation errors to Sentry - these are expected user errors
		if (
			! ( e instanceof Error ) ||
			( ! e.message.includes( 'No suitable importer found for the provided backup contents' ) &&
				! e.message.includes( 'No suitable backup handler found for the provided backup file' ) )
		) {
			Sentry.captureException( e );
		}
		throw e;
	}
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
		blueprint?: Blueprint;
		adminUsername?: string;
		adminPassword?: string;
		adminEmail?: string;
		noStart?: boolean;
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
		adminUsername,
		adminPassword,
		adminEmail,
		noStart = false,
	} = config;

	const siteId = providedSiteId || crypto.randomUUID();

	const metric = getBlueprintMetric( blueprint?.slug );
	bumpStat( StatsGroup.STUDIO_SITE_CREATE, metric );

	try {
		const { server } = await SiteServer.create(
			{
				path,
				name: siteName,
				wpVersion,
				phpVersion,
				customDomain,
				enableHttps,
				siteId,
				blueprint: blueprint?.blueprint,
				adminUsername,
				adminPassword,
				adminEmail,
				noStart,
			},
			{ wpVersion, blueprint: blueprint?.blueprint }
		);

		// If the site is running after creation, fetch theme details and update thumbnail
		if ( server.details.running ) {
			void loadThemeDetails( event, server.details.id );
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

		const pm2Logs = readPm2Logs( siteId );
		if ( pm2Logs.stdout && pm2Logs.stdout.length > 0 ) {
			contexts.playgroundLogs = { entries: pm2Logs.stdout };
		}
		if ( pm2Logs.stderr && pm2Logs.stderr.length > 0 ) {
			contexts.playgroundErrors = { entries: pm2Logs.stderr };
		}

		Sentry.captureException( error, {
			tags: {
				provider: 'cli',
			},
			contexts,
		} );

		throw error;
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

		const userData = await loadUserData();
		const freshSiteData = userData.sites.find( ( s ) => s.id === updatedSite.id );
		if ( freshSiteData ) {
			const wasRunning = server.details.running;

			if ( wasRunning ) {
				const url = freshSiteData.customDomain
					? `${ freshSiteData.enableHttps ? 'https' : 'http' }://${ freshSiteData.customDomain }`
					: `http://localhost:${ freshSiteData.port }`;

				server.details = {
					...freshSiteData,
					running: true,
					url,
				};

				server.server.url = url;
			} else {
				server.details = {
					...freshSiteData,
					running: false,
				};
			}
		}
	}
}

export async function startServer( event: IpcMainInvokeEvent, id: string ): Promise< void > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return;
	}

	try {
		await server.start();
	} catch ( error ) {
		// Skip WASM memory errors - they're user system issues, not bugs
		if ( errorMessageContains( error, 'Cannot allocate Wasm memory for new instance' ) ) {
			throw new Error( 'WASM_ERROR_NOT_ENOUGH_MEMORY' );
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

		const pm2Logs = readPm2Logs( id );
		if ( pm2Logs.stdout && pm2Logs.stdout.length > 0 ) {
			contexts.playgroundLogs = { entries: pm2Logs.stdout };
		}
		if ( pm2Logs.stderr && pm2Logs.stderr.length > 0 ) {
			contexts.playgroundErrors = { entries: pm2Logs.stderr };
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
	}

	console.log( `Server started for '${ server.details.name }'` );
}

export async function stopServer( event: IpcMainInvokeEvent, id: string ): Promise< void > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return;
	}

	await server.stop();
}

export async function stopAllServers(): Promise< void > {
	await triggerStopAllServers( false );
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

	const defaultPath =
		options.defaultPath === nodePath.basename( options.defaultPath ?? '' )
			? nodePath.join( DEFAULT_SITE_PATH, options.defaultPath )
			: options.defaultPath;
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

	const { canceled, filePaths } = await dialog.showOpenDialog( parentWindow, {
		title,
		defaultPath: defaultDialogPath !== '' ? defaultDialogPath : DEFAULT_SITE_PATH,
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

	const finalSitePath = nodePath.join( DEFAULT_SITE_PATH, sanitizeFolderName( siteName ) );

	console.log( `Copying site '${ sourceSite.name }' to '${ siteName }'` );

	await recursiveCopyDirectory( sourceSite.path, finalSitePath );

	const sourceThumbnailPath = getSiteThumbnailPath( sourceSiteId );
	const newThumbnailPath = getSiteThumbnailPath( newSiteId );
	if ( fs.existsSync( sourceThumbnailPath ) ) {
		await fs.promises.copyFile( sourceThumbnailPath, newThumbnailPath );
		// Send thumbnail-loaded event so UI updates immediately
		const thumbnailData = await getImageData( newThumbnailPath );
		sendIpcEventToRendererWithWindow(
			BrowserWindow.fromWebContents( event.sender ),
			'thumbnail-loaded',
			{ id: newSiteId, imageData: thumbnailData }
		);
	}

	const port = await portFinder.getOpenPort();

	const newSiteDetails: StoppedSiteDetails = {
		id: newSiteId,
		name: siteName,
		path: finalSitePath,
		port,
		phpVersion: sourceSite.phpVersion,
		running: false,
		adminUsername: sourceSite.adminUsername,
		adminPassword: sourceSite.adminPassword,
		adminEmail: sourceSite.adminEmail,
		themeDetails: sourceSite.themeDetails,
	};

	try {
		await lockAppdata();
		const userData = await loadUserData();
		userData.sites.push( newSiteDetails );
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}

	SiteServer.register( newSiteDetails );

	return newSiteDetails;
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
	return await updateAppdata( { authToken: undefined } );
}

export async function exportSite(
	event: IpcMainInvokeEvent,
	options: ExportOptions
): Promise< boolean > {
	try {
		await keepSqliteIntegrationUpdated( options.site.path );

		const onEvent = ( data: ImportExportEventData ) => {
			const parentWindow = BrowserWindow.fromWebContents( event.sender );
			sendIpcEventToRendererWithWindow( parentWindow, 'on-export', data, options.site.id );
		};

		const result = await exportBackup( options, onEvent );

		if ( result ) {
			const isDatabaseOnly = options.includes.database && ! options.includes.wpContent;
			bumpStat(
				StatsGroup.STUDIO_EXPORT,
				isDatabaseOnly ? StatsMetric.DATABASE_ONLY : StatsMetric.FULL_SITE
			);
		} else {
			bumpStat( StatsGroup.STUDIO_EXPORT, StatsMetric.FAILURE );
		}

		return result;
	} catch ( e ) {
		bumpStat( StatsGroup.STUDIO_EXPORT, StatsMetric.FAILURE );
		Sentry.captureException( e );
		throw e;
	}
}

export async function saveSnapshotsToStorage( event: IpcMainInvokeEvent, snapshots: Snapshot[] ) {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		userData.snapshots = snapshots;
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function saveLastSeenVersion( event: IpcMainInvokeEvent, version: string ) {
	await updateAppdata( { lastSeenVersion: version } );
}

export async function getSnapshots( _event: IpcMainInvokeEvent ): Promise< Snapshot[] > {
	const userData = await loadUserData();
	const { snapshots = [] } = userData;
	return snapshots;
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

	let url = new URL( relativeURL, site.server.url );
	if ( autoLogin ) {
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

export async function generateProposedSitePath(
	_event: IpcMainInvokeEvent,
	siteName: string
): Promise< FolderDialogResponse > {
	const path = nodePath.join( DEFAULT_SITE_PATH, sanitizeFolderName( siteName ) );

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
	return generateSiteName(
		usedSites.map( ( s ) => s.name ),
		DEFAULT_SITE_PATH
	);
}

export async function generateNumberedNameFromList(
	_event: IpcMainInvokeEvent,
	baseName: string,
	usedSites: SiteDetails[]
): Promise< string > {
	return generateNumberedName(
		baseName,
		usedSites.map( ( s ) => s.name ),
		DEFAULT_SITE_PATH
	);
}

export async function openLocalPath( _event: IpcMainInvokeEvent, path: string ) {
	await shell.openPath( path );
}

export function showItemInFolder( _event: IpcMainInvokeEvent, path: string ) {
	shell.showItemInFolder( path );
}

// Update a site's theme details and thumbnail. Emit the appropriate IPC events to the renderer
// process.
export async function loadThemeDetails(
	event: IpcMainInvokeEvent,
	id: string,
	emitThemeDetailsLoadingEvent = true
): Promise< StartedSiteDetails[ 'themeDetails' ] > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( emitThemeDetailsLoadingEvent ) {
		sendIpcEventToRendererWithWindow( parentWindow, 'theme-details-loading', { id } );
		sendIpcEventToRendererWithWindow( parentWindow, 'thumbnail-loading', { id } );
	}

	const oldThemePath = server.details.themeDetails?.path;
	const themeDetails = await server.getThemeDetails();
	const hasThemeChanged = themeDetails?.path !== oldThemePath;

	sendIpcEventToRendererWithWindow( parentWindow, 'theme-details-loaded', {
		id,
		details: themeDetails,
	} );

	try {
		if ( hasThemeChanged ) {
			if ( ! emitThemeDetailsLoadingEvent ) {
				sendIpcEventToRendererWithWindow( parentWindow, 'thumbnail-loading', { id } );
			}
			await server.persistThemeDetails();
		}
		await server.updateCachedThumbnail();
		const thumbnailPath = getSiteThumbnailPath( id );
		const thumbnailData = await getImageData( thumbnailPath );
		sendIpcEventToRendererWithWindow( parentWindow, 'thumbnail-loaded', {
			id,
			imageData: thumbnailData,
		} );
	} catch ( error ) {
		sendIpcEventToRendererWithWindow( parentWindow, 'thumbnail-load-error', { id } );
		console.error( `Failed to update thumbnail for server ${ id }:`, error );
	}

	return themeDetails;
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
		return promiseExec( `gnome-terminal --working-directory=${ targetPath }` );
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
	const simplifiedError = simplifyErrorForDisplay( error );
	// Remove prepended error message added by IPC handler
	const filteredError = ( simplifiedError as Error )?.message?.replace(
		/Error invoking remote method '\w+': Error:/g,
		''
	);
	const response = await showMessageBox( event, {
		type: 'error',
		message: title,
		detail: error ? `${ message }\n\n${ filteredError }` : message,
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

export async function setupAppMenu(
	_event: IpcMainInvokeEvent,
	config: { needsOnboarding: boolean; isAddSiteVisible?: boolean }
) {
	await setupMenu( config );
}

export async function popupAppMenu( _event: IpcMainInvokeEvent ) {
	await popupMenu();
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

export function toggleMinWindowWidth( event: IpcMainInvokeEvent, isSidebarVisible: boolean ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow || parentWindow.isDestroyed() || event.sender.isDestroyed() ) {
		return;
	}
	const [ currentWidth, currentHeight ] = parentWindow.getSize();
	const newWidth = Math.max(
		MAIN_MIN_WIDTH,
		isSidebarVisible ? currentWidth - SIDEBAR_WIDTH : currentWidth + SIDEBAR_WIDTH
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
	return fs.statSync( nodePath.join( site.details.path, ...filePath ) ).size;
}

export function openCertificate( _event: IpcMainInvokeEvent ) {
	return openCertificateDialog();
}

export async function isCATrusted(): Promise< boolean > {
	return isRootCATrusted();
}

export async function trustCertificate( event: IpcMainInvokeEvent ): Promise< void > {
	const platform = process.platform;
	if ( platform === 'win32' ) {
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
			label: __( 'Copy site…' ),
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

export async function getAllCustomDomains(): Promise< string[] > {
	const userData = await loadUserData();

	return userData.sites
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
	currentDepth: number = 0
): Promise< RawDirectoryEntry[] > {
	const server = SiteServer.get( siteId );
	if ( ! server ) throw new Error( 'Site not found' );

	const fullPath = nodePath.join( server.details.path, path );

	try {
		const entries = await fs.promises.readdir( fullPath, { withFileTypes: true } );
		const result = [];

		for ( const entry of entries ) {
			if ( shouldExcludeFromSync( entry.name ) ) {
				continue;
			}

			const isDirectory = entry.isDirectory();
			const itemPath = nodePath.join( path, entry.name ).replace( /\\/g, '/' );

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
						currentDepth + 1
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

	const fileContents = await fsPromises.readFile( resolvedPath, 'utf-8' );
	return JSON.parse( fileContents );
}

export async function setWindowControlVisibility( event: IpcMainInvokeEvent, visible: boolean ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( parentWindow && process.platform === 'darwin' ) {
		parentWindow.setWindowButtonVisibility( visible );
		if ( visible ) {
			parentWindow.setWindowButtonPosition( MACOS_TRAFFIC_LIGHT_POSITION );
		}
	}
}

export async function updateSitesSortOrder(
	event: IpcMainInvokeEvent,
	updates: { siteId: string; sortOrder: number }[]
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();

		const updatedSites = userData.sites.map( ( site ) => {
			const update = updates.find( ( u ) => u.siteId === site.id );
			if ( update ) {
				return { ...site, sortOrder: update.sortOrder };
			}
			return site;
		} );

		await saveUserData( { ...userData, sites: updatedSites } );
	} finally {
		await unlockAppdata();
	}
}
