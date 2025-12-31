import { exec, ExecOptions } from 'child_process';
import crypto from 'crypto';
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
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { __, sprintf, LocaleData, defaultI18n } from '@wordpress/i18n';
import { validateBlueprintData } from 'common/lib/blueprint-validation';
import { bumpStat } from 'common/lib/bump-stat';
import {
	calculateDirectorySize,
	isWordPressDirectory,
	arePathsEqual,
	isEmptyDir,
	pathExists,
} from 'common/lib/fs-utils';
import { getWordPressVersion } from 'common/lib/get-wordpress-version';
import { isErrnoException } from 'common/lib/is-errno-exception';
import { getAuthenticationUrl } from 'common/lib/oauth';
import { createPassword } from 'common/lib/passwords';
import { portFinder } from 'common/lib/port-finder';
import { sortSites } from 'common/lib/sort-sites';
import { Snapshot } from 'common/types/snapshot';
import { StatsGroup, StatsMetric } from 'common/types/stats';
import { MAIN_MIN_WIDTH, SIDEBAR_WIDTH } from 'src/constants';
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
import { sanitizeFolderName } from 'src/lib/generate-site-name';
import { getImageData } from 'src/lib/get-image-data';
import { getSiteUrl } from 'src/lib/get-site-url';
import { exportBackup } from 'src/lib/import-export/export/export-manager';
import { ExportOptions } from 'src/lib/import-export/export/types';
import { ImportExportEventData } from 'src/lib/import-export/handle-events';
import { defaultImporterOptions, importBackup } from 'src/lib/import-export/import/import-manager';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { isInstalled } from 'src/lib/is-installed';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import * as oauthClient from 'src/lib/oauth';
import { phpGetThemeDetails } from 'src/lib/php-get-theme-details';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { installSqliteIntegration, keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import { updateSiteUrl } from 'src/lib/update-site-url';
import * as windowsHelpers from 'src/lib/windows-helpers';
import {
	getWordPressProvider,
	getProviderConstants as getProviderConstantsFromProvider,
} from 'src/lib/wordpress-provider';
import { getLogsFilePath, writeLogToFile, type LogLevel } from 'src/logging';
import { getMainWindow } from 'src/main-window';
import { popupMenu, setupMenu } from 'src/menu';
import { shouldExcludeFromSync, shouldLimitDepth } from 'src/modules/sync/lib/tree-utils';
import { supportedEditorConfig, SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { getUserTerminal } from 'src/modules/user-settings/lib/ipc-handlers';
import { winFindEditorPath } from 'src/modules/user-settings/lib/win-editor-path';
import { SiteServer, createSiteWorkingDirectory } from 'src/site-server';
import { DEFAULT_SITE_PATH, getSiteThumbnailPath } from 'src/storage/paths';
import {
	loadUserData,
	lockAppdata,
	saveUserData,
	unlockAppdata,
	updateAppdata,
} from 'src/storage/user-data';
import { Blueprint } from 'src/stores/wpcom-api';
import type { WpCliResult } from 'src/lib/wp-cli-process';
import type { RawDirectoryEntry } from 'src/modules/sync/types';

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
	pushArchive,
	removeExportedSiteTmpFile,
	removeSyncBackup,
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

async function sendThumbnailChangedEvent( event: IpcMainInvokeEvent, id: string ) {
	if ( event.sender.isDestroyed() ) {
		return;
	}
	const thumbnailData = await getThumbnailData( event, id );
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	sendIpcEventToRendererWithWindow( parentWindow, 'thumbnail-changed', {
		id,
		imageData: thumbnailData,
	} );
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
			SiteServer.create( site );
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
			await getWordPressProvider().setupWordPressFilesOnly( site.details.path );
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
	} = {}
): Promise< SiteDetails > {
	const {
		siteName,
		wpVersion,
		customDomain,
		enableHttps,
		siteId,
		blueprint,
		phpVersion = getWordPressProvider().DEFAULT_PHP_VERSION,
	} = config;

	const forceSetupSqlite = false;

	const metric = getBlueprintMetric( blueprint?.slug );
	bumpStat( StatsGroup.STUDIO_SITE_CREATE, metric );

	// We only recursively create the directory if the user has not selected a
	// path from the dialog (and thus they use the "default" or suggested path).
	if ( ! ( await pathExists( path ) ) && path.startsWith( DEFAULT_SITE_PATH ) ) {
		fs.mkdirSync( path, { recursive: true } );
	}

	if ( ! ( await isEmptyDir( path ) ) && ! isWordPressDirectory( path ) ) {
		// Form validation should've prevented a non-empty directory from being selected
		throw new Error( 'The selected directory is not empty nor an existing WordPress site.' );
	}
	let userData = await loadUserData();

	const allPaths = userData?.sites?.map( ( site ) => site.path ) || [];
	if ( allPaths.includes( path ) ) {
		throw new Error( 'The selected directory is already in use.' );
	}

	const port = await portFinder.getOpenPort();

	const details = {
		id: siteId || crypto.randomUUID(),
		name: siteName || nodePath.basename( path ),
		path,
		adminPassword: createPassword(),
		port,
		running: false,
		phpVersion,
		isWpAutoUpdating: wpVersion === getWordPressProvider().DEFAULT_WORDPRESS_VERSION,
		customDomain,
		enableHttps,
	} as const;

	const server = SiteServer.create( details, { wpVersion, blueprint: blueprint?.blueprint } );

	if ( ( await pathExists( path ) ) && ( await isEmptyDir( path ) ) ) {
		try {
			await createSiteWorkingDirectory( server, wpVersion );
		} catch ( error ) {
			// If site creation failed, remove the generated files and re-throw the
			// error so it can be handled by the caller.
			await shell.trashItem( path );
			throw error;
		}
	}

	if ( isWordPressDirectory( path ) ) {
		// If the directory contains a WordPress installation, and user wants to force SQLite
		// integration, let's rename the wp-config.php file to allow WP Now to create a new one
		// and initialize things properly.
		if ( forceSetupSqlite && ( await pathExists( nodePath.join( path, 'wp-config.php' ) ) ) ) {
			fs.renameSync(
				nodePath.join( path, 'wp-config.php' ),
				nodePath.join( path, 'wp-config-studio.php' )
			);
		}
		if ( ! ( await pathExists( nodePath.join( path, 'wp-config.php' ) ) ) ) {
			await installSqliteIntegration( path );
			await getWordPressProvider().installWordPressWhenNoWpConfig(
				server,
				siteName || nodePath.basename( path ),
				details.adminPassword
			);
		} else {
			await updateSiteUrl( server, getSiteUrl( details ) );
		}
	}

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	sendIpcEventToRendererWithWindow( parentWindow, 'theme-details-updating', { id: details.id } );
	try {
		await lockAppdata();
		userData = await loadUserData();

		userData.sites.push( server.details );
		sortSites( userData.sites );

		await saveUserData( userData );
		return server.details;
	} finally {
		await unlockAppdata();
	}
}

export async function updateSite(
	event: IpcMainInvokeEvent,
	updatedSite: SiteDetails
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const updatedSites = userData.sites.map( ( site ) =>
			site.id === updatedSite.id ? updatedSite : site
		);
		userData.sites = updatedSites;

		const server = SiteServer.get( updatedSite.id );
		if ( server ) {
			await server.updateSiteDetails( updatedSite );
		}
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function startServer(
	event: IpcMainInvokeEvent,
	id: string
): Promise< SiteDetails | null > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return null;
	}

	await keepSqliteIntegrationUpdated( server.details.path );

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	try {
		await server.start();
	} catch ( error ) {
		/**
		 * We don't want to track WASM memory errors in Sentry
		 * because they are caused by the user's system not having enough memory
		 * and aren't a bug in Studio.
		 *
		 * When the error is thrown, we show a user-friendly message
		 * to the user, with instructions on how to provide more memory to Studio.
		 */
		if (
			error instanceof Error &&
			error.message.includes( 'Cannot allocate Wasm memory for new instance' )
		) {
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

		// Include sanitized CLI args if available from error
		if ( error instanceof Error && 'cliArgs' in error ) {
			contexts.startup = ( error as Error & { cliArgs: Record< string, unknown > } ).cliArgs;
		}

		Sentry.captureException( error, {
			tags: {
				provider: getWordPressProvider().PROVIDER_TYPE,
			},
			contexts,
		} );
		if (
			error instanceof Error &&
			error.message.includes( '"unreachable" WASM instruction executed' )
		) {
			throw new Error( 'Please try disabling plugins and themes that might be causing the issue.' );
		}
		throw error;
	}

	sendIpcEventToRendererWithWindow( parentWindow, 'theme-details-changed', {
		id,
		details: server.details.themeDetails,
	} );

	if ( server.details.running ) {
		void ( async () => {
			try {
				await server.updateCachedThumbnail();
				await sendThumbnailChangedEvent( event, id );
			} catch ( error ) {
				console.error( `Failed to update thumbnail for server ${ id }:`, error );
			}
		} )();
	}

	console.log( `Server started for '${ server.details.name }'` );
	await updateSite( event, server.details );
	return server.details;
}

export async function stopServer(
	event: IpcMainInvokeEvent,
	id: string
): Promise< SiteDetails | null > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return null;
	}

	await server.stop();
	await updateSite( event, server.details );
	return server.details;
}

export interface FolderDialogResponse {
	path: string;
	name: string;
	isEmpty: boolean;
	isWordPress: boolean;
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
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const server = SiteServer.get( id );
		console.log( 'Deleting site', id );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}
		await server.delete();
		try {
			// Move files to trash
			if ( deleteFiles ) {
				await shell.trashItem( server.details.path );
			}
		} catch ( error ) {
			/* We want to exit gracefully if the there is an error deleting the site files */
			Sentry.captureException( error );
		}
		const newSites = userData.sites.filter( ( site ) => site.id !== id );
		await saveUserData( { ...userData, sites: newSites } );
	} finally {
		await unlockAppdata();
	}
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
			throw new Error( __( 'The site name is too long. Please choose a shorter site name.' ) );
		}
		throw err;
	}
}

export async function openLocalPath( _event: IpcMainInvokeEvent, path: string ) {
	await shell.openPath( path );
}

export function showItemInFolder( _event: IpcMainInvokeEvent, path: string ) {
	shell.showItemInFolder( path );
}

export async function getThemeDetails(
	event: IpcMainInvokeEvent,
	id: string
): Promise< StartedSiteDetails[ 'themeDetails' ] > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	if ( ! server.details.running || ! server.server ) {
		return undefined;
	}
	const themeDetails = await phpGetThemeDetails( server.server );

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( themeDetails?.path && themeDetails.path !== server.details.themeDetails?.path ) {
		sendIpcEventToRendererWithWindow( parentWindow, 'theme-details-updating', { id } );
		const updatedSite = {
			...server.details,
			themeDetails,
		};
		sendIpcEventToRendererWithWindow( parentWindow, 'theme-details-changed', {
			id,
			details: themeDetails,
		} );

		void server
			.updateCachedThumbnail()
			.then( () => sendThumbnailChangedEvent( event, id ) )
			.catch( ( error ) => {
				console.error( `Failed to update thumbnail for server ${ id }:`, error );
			} );
		server.details.themeDetails = themeDetails;
		await updateSite( event, updatedSite );
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

		return promiseExec( `start "Command Prompt" ${ defaultShell }`, {
			cwd: targetPath,
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
	filePath: string
): Promise< void > {
	const platform = process.platform;
	const editor = supportedEditorConfig[ editorKey ];

	if ( platform === 'darwin' ) {
		return promiseExec( `open -b ${ editor.macOSBundleId } "${ filePath }"` );
	}

	if ( platform === 'win32' ) {
		const editorPath = await winFindEditorPath( editorKey );
		if ( ! editorPath ) {
			// Fall back to using openURL if no editor path is found
			return openURL( event, editor.url( filePath ) );
		}

		return promiseExec( `"${ editorPath }" "${ filePath }"` );
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
 */
export async function openFileInIDE(
	_event: IpcMainInvokeEvent,
	relativePath: string,
	siteId: string
) {
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	const path = await getAbsolutePathFromSite( _event, siteId, relativePath );
	if ( ! path ) {
		return;
	}

	if ( isInstalled( 'vscode' ) ) {
		// Open site first to ensure the file is opened within the site context
		await shellOpenExternalWrapper( `vscode://file/${ server.details.path }?windowId=_blank` );
		await shellOpenExternalWrapper( `vscode://file/${ path }` );
	} else if ( isInstalled( 'phpstorm' ) ) {
		// Open site first to ensure the file is opened within the site context
		await shellOpenExternalWrapper( `phpstorm://open?file=${ path }` );
	}
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
	return calculateDirectorySize( nodePath.join( site.details.path, ...subdir ) );
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
			label: __( 'Delete site…' ),
			enabled: ! isLoading && ! isAddingSite && ! isSyncing,
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

export async function getProviderConstants( _event: IpcMainInvokeEvent ) {
	const provider = getWordPressProvider();
	return getProviderConstantsFromProvider( provider );
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
	}
}
