import { resolveActivitySoundPreferences } from '@studio/common/lib/activity-sounds';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import {
	STUDIO_ASSISTANT_QUOTA_URL,
	studioAssistantQuotaSchema,
} from '@studio/common/lib/studio-assistant-quota';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { __, sprintf } from '@wordpress/i18n';
import { buildPublishCheckoutUrl } from '../publish-checkout-url';
import type {
	ActiveAgentRun,
	AiSessionSummary,
	AiSessionPlacementUpdatedEvent,
	AppUpdateStatus,
	AuthUser,
	AvailableSitePath,
	ColorScheme,
	Connector,
	ExtractedBlueprintBundle,
	InstalledApps,
	InstructionFileStatus,
	LocalMediaFile,
	LoadedAiSession,
	ProposedSitePath,
	QuitSitesBehavior,
	SelectedSiteFolder,
	SiteCheckpoint,
	SiteDetails,
	SiteOverviewDetails,
	SiteOverviewExtension,
	SkillStatus,
	Snapshot,
	SnapshotUsage,
	StudioAssistantQuota,
	SupportedEditor,
	SupportedTerminal,
	SyncableWpcomSitesPage,
	SyncSite,
	ToolPermissionOverrides,
	UserSettingsEventTab,
	UserPreferences,
} from '../../types';
import type { AgentRunEvent } from '@studio/common/ai/agent-events';
import type { AiModelId } from '@studio/common/ai/models';
import type { AiResponseLength } from '@studio/common/ai/response-length';
import type { StoredAuthToken } from '@studio/common/lib/auth-token-schema';
import type { SiteEvent } from '@studio/common/lib/cli-events';
import type { ImportEventTuple } from '@studio/common/lib/import-export-events';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

function generateBackupFilename( siteName: string ): string {
	const now = new Date();
	const pad = ( n: number ) => String( n ).padStart( 2, '0' );
	const timestamp =
		`${ now.getFullYear() }-${ pad( now.getMonth() + 1 ) }-${ pad( now.getDate() ) }` +
		`-${ pad( now.getHours() ) }-${ pad( now.getMinutes() ) }-${ pad( now.getSeconds() ) }`;
	return sanitizeFolderName( `studio-backup-${ siteName }-${ timestamp }` );
}

type WpCliResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

function parseSnapshotUsage( response: unknown ): SnapshotUsage {
	if ( ! response || typeof response !== 'object' ) {
		throw new Error( 'Invalid snapshot usage response.' );
	}
	const record = response as Record< string, unknown >;
	if (
		typeof record.site_count !== 'number' ||
		typeof record.site_limit !== 'number' ||
		typeof record.site_creation_blocked !== 'boolean'
	) {
		throw new Error( 'Invalid snapshot usage response.' );
	}
	return {
		siteCount: record.site_count,
		siteLimit: record.site_limit,
		siteCreationBlocked: record.site_creation_blocked,
	};
}

const SITE_OVERVIEW_DETAILS_SCRIPT = [
	'require_once ABSPATH . "wp-admin/includes/plugin.php";',
	'$plugins = array();',
	'foreach (get_plugins() as $plugin_file => $plugin_data) { $plugins[] = array("slug" => $plugin_file, "name" => empty($plugin_data["Name"]) ? $plugin_file : $plugin_data["Name"], "status" => is_plugin_active($plugin_file) ? "active" : "inactive", "version" => empty($plugin_data["Version"]) ? "" : $plugin_data["Version"]); }',
	'$themes = array();',
	'$active_theme = get_stylesheet();',
	'foreach (wp_get_themes() as $stylesheet => $theme) { $themes[] = array("slug" => $stylesheet, "name" => $theme->get("Name") ?: $stylesheet, "status" => $stylesheet === $active_theme ? "active" : "inactive", "version" => $theme->get("Version") ?: ""); }',
	'echo wp_json_encode(array("plugins" => $plugins, "themes" => $themes));',
].join( ' ' );

const SITE_OVERVIEW_DETAILS_COMMAND = `eval '${ SITE_OVERVIEW_DETAILS_SCRIPT }'`;

function parseSiteOverviewDetails( result: WpCliResult ): SiteOverviewDetails {
	if ( result.exitCode !== 0 ) {
		throw new Error( result.stderr || 'Failed to load site overview details.' );
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse( result.stdout );
	} catch {
		throw new Error( 'Site overview details returned invalid JSON.' );
	}

	const record =
		parsed && typeof parsed === 'object' ? ( parsed as Record< string, unknown > ) : {};

	return {
		plugins: normalizeOverviewExtensions( record.plugins ),
		themes: normalizeOverviewExtensions( record.themes ),
	};
}

function normalizeOverviewExtensions( value: unknown ): SiteOverviewExtension[] {
	if ( ! Array.isArray( value ) ) {
		return [];
	}

	return value
		.flatMap( ( extension ) => {
			const record =
				extension && typeof extension === 'object'
					? ( extension as Record< string, unknown > )
					: {};
			const slug = getText( record.slug );
			const name = getText( record.name ) ?? slug;

			if ( ! slug || ! name ) {
				return [];
			}

			return [
				{
					slug,
					name,
					status: getText( record.status ),
					version: getText( record.version ),
				},
			];
		} )
		.sort( ( first, second ) => {
			const statusOrder =
				getExtensionStatusSortValue( first.status ) - getExtensionStatusSortValue( second.status );
			return statusOrder || first.name.localeCompare( second.name );
		} );
}

function getText( value: unknown ): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getExtensionStatusSortValue( status: string | undefined ) {
	return status === 'active' ? 0 : 1;
}

/**
 * Creates a connector that delegates to the Electron IPC bridge.
 * Expects `window.ipcApi` to be exposed by the preload script.
 */
export function createIpcConnector(): Connector {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ipcApi = ( window as any ).ipcApi;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ipcListener = ( window as any ).ipcListener;

	if ( ! ipcApi ) {
		throw new Error(
			'IPC API not available. Are you running inside Electron with the preload script?'
		);
	}

	// The IPC connector only runs in Electron, so `navigator` reflects the
	// desktop OS.
	const isMacOS = /mac/i.test( navigator.platform || navigator.userAgent );

	async function fetchWpcomJson( url: string, errorLabel: string ): Promise< unknown > {
		const token = ( await ipcApi.getAuthenticationToken() ) as StoredAuthToken | null;
		if ( ! token ) {
			return null;
		}
		const response = await fetch( url, {
			headers: { Authorization: `Bearer ${ token.accessToken }` },
		} );
		if ( ! response.ok ) {
			throw new Error( `Failed to fetch ${ errorLabel }: ${ response.status }` );
		}
		return response.json();
	}

	// Preview CLI commands are path-based, not id-based. Look up the matching
	// site once per call so UI code can keep working with the stable site id.
	async function resolveSiteFolder( siteId: string ): Promise< string > {
		const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
		const site = sites.find( ( candidate ) => candidate.id === siteId );
		if ( ! site ) {
			throw new Error( `Site ${ siteId } not found` );
		}
		return site.path;
	}

	async function executeWpCli(
		siteId: string,
		args: string,
		options: { skipPluginsAndThemes?: boolean } = {}
	): Promise< WpCliResult > {
		return ( await ipcApi.executeWPCLiInline( {
			siteId,
			args,
			skipPluginsAndThemes: options.skipPluginsAndThemes ?? true,
		} ) ) as WpCliResult;
	}

	async function markConnectedWpcomSiteSynced(
		localSiteId: string,
		remoteSiteId: number,
		direction: 'push' | 'pull'
	): Promise< void > {
		try {
			const connectedSites = ( await ipcApi.getConnectedWpcomSites( localSiteId ) ) as SyncSite[];
			const connectedSite = connectedSites.find(
				( site ) => site.id === remoteSiteId && site.localSiteId === localSiteId
			);

			if ( ! connectedSite ) {
				return;
			}

			const timestampKey = direction === 'push' ? 'lastPushTimestamp' : 'lastPullTimestamp';
			await ipcApi.updateConnectedWpcomSites( [
				{
					...connectedSite,
					[ timestampKey ]: new Date().toISOString(),
				},
			] );
		} catch ( error ) {
			console.warn( 'Failed to update connected site sync timestamp:', error );
		}
	}

	// Bridges `createSnapshot`/`updateSnapshot`'s fire-and-forget IPC pattern
	// into an awaitable promise. The main process emits `snapshot-key-value`
	// with the final preview URL right before `snapshot-success`; fatal
	// errors arrive via `snapshot-fatal-error`. All three are broadcast to
	// every renderer subscriber, so we filter by operationId.
	function awaitSnapshotOperation( operationId: string ): Promise< { url: string } > {
		return new Promise( ( resolve, reject ) => {
			let capturedUrl: string | undefined;
			const unsubscribes: Array< () => void > = [];
			const cleanup = () => {
				for ( const unsubscribe of unsubscribes ) {
					unsubscribe();
				}
			};

			unsubscribes.push(
				ipcListener.subscribe(
					'snapshot-key-value',
					(
						_event: unknown,
						payload: { operationId: string; data: { key: string; value: string } }
					) => {
						if ( payload.operationId === operationId && payload.data.key === 'url' ) {
							capturedUrl = payload.data.value;
						}
					}
				)
			);
			unsubscribes.push(
				ipcListener.subscribe(
					'snapshot-success',
					( _event: unknown, payload: { operationId: string } ) => {
						if ( payload.operationId !== operationId ) {
							return;
						}
						cleanup();
						if ( capturedUrl ) {
							resolve( { url: capturedUrl } );
						} else {
							reject( new Error( 'Preview site command succeeded but no URL was returned.' ) );
						}
					}
				)
			);
			unsubscribes.push(
				ipcListener.subscribe(
					'snapshot-fatal-error',
					( _event: unknown, payload: { operationId: string; data: { message: string } } ) => {
						if ( payload.operationId !== operationId ) {
							return;
						}
						cleanup();
						reject( new Error( payload.data.message ) );
					}
				)
			);
		} );
	}

	return {
		async init() {
			// Install the application menu (View > Toggle DevTools, etc.).
			// The old renderer does this from its app bootstrap; the new UI
			// needs to opt in explicitly.
			await ipcApi.setupAppMenu( { needsOnboarding: false } );
		},

		// Native desktop app: every affordance is available.
		capabilities: {
			nativeFolderPicker: true,
			nativeSaveDialog: true,
			openInOS: true,
			annotatePreview: true,
			siteCheckpoints: true,
			readLocalMedia: true,
			agentInstructions: true,
			studioLogs: true,
			switchToClassicUi: true,
		},

		// Auth — optional in Electron, delegated to main process
		requiresAuth: false,
		supportsAgenticOptOut: true,

		async isAuthenticated(): Promise< boolean > {
			return ipcApi.isAuthenticated();
		},

		async getAuthUser(): Promise< AuthUser | null > {
			const token = await ipcApi.getAuthenticationToken();
			if ( ! token ) {
				return null;
			}
			return {
				id: token.id,
				email: token.email,
				displayName: token.displayName,
			};
		},

		async authenticate( signup = false ): Promise< void > {
			await ipcApi.authenticate( signup );
		},

		async logout(): Promise< void > {
			await ipcApi.clearAuthenticationToken();
		},

		onAuthStateChanged( listener ) {
			return ipcListener.subscribe( 'auth-updated', () => listener() );
		},

		// Onboarding
		async getOnboardingCompleted(): Promise< boolean > {
			return ipcApi.getOnboardingData();
		},

		async setOnboardingCompleted( completed: boolean ): Promise< void > {
			await ipcApi.saveOnboarding( completed );
		},

		// Sites
		async getSites(): Promise< SiteDetails[] > {
			return ( await ipcApi.getSiteDetails() ) as SiteDetails[];
		},

		async createSite( params ) {
			const {
				name,
				path,
				phpVersion,
				runtime,
				fileAccess,
				wpVersion,
				customDomain,
				enableHttps,
				adminUsername,
				adminPassword,
				adminEmail,
				blueprint,
				skipStart,
				flowType,
			} = params;
			return ( await ipcApi.createSite( path, {
				siteName: name,
				phpVersion,
				runtime,
				fileAccess,
				wpVersion,
				customDomain,
				enableHttps,
				adminUsername,
				adminPassword,
				adminEmail,
				blueprint,
				noStart: skipStart,
				flowType,
			} ) ) as SiteDetails;
		},

		async deleteSite( id, deleteFiles = true ) {
			await ipcApi.deleteSite( id, deleteFiles );
		},

		async copySite( sourceSiteId ): Promise< SiteDetails > {
			const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
			const sourceSite = sites.find( ( site ) => site.id === sourceSiteId );
			if ( ! sourceSite ) {
				throw new Error( 'Source site not found.' );
			}
			// `%s Copy` matches the legacy Studio flow, and the helper bumps
			// the suffix (`Copy 2`, `Copy 3`…) when earlier copies already
			// exist.
			const baseName = `${ sourceSite.name } Copy`;
			const newName = ( await ipcApi.generateNumberedNameFromList( baseName, sites ) ) as string;
			const newSiteId = crypto.randomUUID();
			return ( await ipcApi.copySite( sourceSiteId, newSiteId, newName ) ) as SiteDetails;
		},

		async generateProposedSiteName( usedSites ): Promise< string > {
			return ( await ipcApi.generateSiteNameFromList( usedSites ) ) as string;
		},

		async generateNumberedSiteName( baseName, usedSites ): Promise< string > {
			return ( await ipcApi.generateNumberedNameFromList( baseName, usedSites ) ) as string;
		},

		async findAvailableSitePath( baseName ): Promise< AvailableSitePath > {
			// The main process resolves the numbered-name collision search in a
			// single call (checking both existing site names and non-empty site
			// folders) — same helper `copySite` uses above.
			const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
			const name = ( await ipcApi.generateNumberedNameFromList( baseName, sites ) ) as string;
			const { path } = ( await ipcApi.generateProposedSitePath( name ) ) as { path: string };
			return { name, path };
		},

		async generateProposedSitePath( siteName ): Promise< ProposedSitePath > {
			const response = ( await ipcApi.generateProposedSitePath( siteName ) ) as {
				path: string;
				isEmpty: boolean;
				isWordPress: boolean;
				isNameTooLong?: boolean;
			};
			return {
				path: response.path,
				isEmpty: response.isEmpty,
				isWordPress: response.isWordPress,
				isNameTooLong: response.isNameTooLong,
			};
		},

		async selectSiteFolder( defaultPath ): Promise< SelectedSiteFolder | null > {
			const response = ( await ipcApi.showOpenFolderDialog(
				'Choose folder for site',
				defaultPath
			) ) as SelectedSiteFolder | null;
			return response ?? null;
		},

		async comparePaths( path1, path2 ) {
			return ( await ipcApi.comparePaths( path1, path2 ) ) as boolean;
		},

		async getWordPressVersions() {
			// Fetches straight from the wordpress.org version-check API (the
			// renderer CSP allows api.wordpress.org) using the same shared
			// helper the desktop renderer's version selector relies on.
			return fetchWordPressVersions();
		},

		async getWpVersion( siteId ) {
			return ( await ipcApi.getWpVersion( siteId ) ) as string;
		},

		async getFilePath( file ) {
			// `webUtils.getPathForFile` is a synchronous preload-only API; the
			// connector wraps it in a Promise to keep the surface uniform and
			// to leave room for non-Electron connectors that might resolve the
			// path asynchronously.
			return ( ipcApi.getPathForFile( file ) as string ) ?? '';
		},

		async createTemporaryTextFile( name, contents ): Promise< string > {
			return ( await ipcApi.createTemporaryTextFile( name, contents ) ) as string;
		},

		async readLocalMediaFile( path ): Promise< LocalMediaFile > {
			return ( await ipcApi.readLocalMediaFile( path ) ) as LocalMediaFile;
		},

		async captureSiteScreenshot( webContentsId, options ): Promise< LocalMediaFile > {
			return ( await ipcApi.captureSiteScreenshot( webContentsId, options ) ) as LocalMediaFile;
		},

		async captureFullPageScreenshot( url, options ): Promise< LocalMediaFile > {
			return ( await ipcApi.captureFullPageScreenshot( url, options ) ) as LocalMediaFile;
		},

		async extractBlueprintBundle( file ): Promise< ExtractedBlueprintBundle > {
			const zipFilePath = ( ipcApi.getPathForFile( file ) as string ) ?? '';
			if ( ! zipFilePath ) {
				throw new Error(
					__( 'Unable to resolve the ZIP file path. Try choosing the file via the button.' )
				);
			}
			return ( await ipcApi.extractBlueprintBundle( zipFilePath ) ) as ExtractedBlueprintBundle;
		},

		async cleanupBlueprintTempDir( tempDir ) {
			await ipcApi.cleanupBlueprintTempDir( tempDir );
		},

		async readBlueprintFile( filePath ) {
			return ipcApi.readBlueprintFile( filePath ) as Promise< BlueprintV1Declaration >;
		},

		onAddSite( listener ) {
			return ipcListener.subscribe( 'add-site', () => listener() );
		},

		onAddSiteWithBlueprint( listener ) {
			return ipcListener.subscribe(
				'add-site-with-blueprint',
				( _event: unknown, payload: { blueprintPath: string } ) => listener( payload )
			);
		},

		async importSiteFromBackup( siteId, backupPath, onProgress ): Promise< void > {
			const unsubscribe = onProgress
				? ipcListener.subscribe(
						'on-import',
						( _event: unknown, importEvent: ImportEventTuple, importSiteId: string ) => {
							if ( importSiteId === siteId ) {
								onProgress( importEvent );
							}
						}
				  )
				: undefined;
			try {
				await ipcApi.importSite( siteId, backupPath, {
					alwaysStartServer: true,
					showErrorModal: false,
					showNotification: false,
					// Onboarding imports are part of the add-site flow, which `studio_site_imported`
					// deliberately does not count.
					suppressTracksEvent: true,
				} );
			} finally {
				unsubscribe?.();
			}
		},

		// Site checkpoints — the main process forks the same `studio checkpoint`
		// CLI commands the terminal user runs.
		async listCheckpoints( siteId ): Promise< SiteCheckpoint[] > {
			return ( await ipcApi.listSiteCheckpoints( siteId ) ) as SiteCheckpoint[];
		},
		async createCheckpoint( siteId, label ) {
			await ipcApi.createSiteCheckpoint( siteId, label );
		},
		async restoreCheckpoint( siteId, checkpointId ) {
			await ipcApi.restoreSiteCheckpoint( siteId, checkpointId );
		},
		async deleteCheckpoint( siteId, checkpointId ) {
			await ipcApi.deleteSiteCheckpoint( siteId, checkpointId );
		},

		async startSite( id ) {
			try {
				await ipcApi.startServer( id );
			} catch ( error ) {
				const sites = ( await ipcApi.getSiteDetails().catch( () => [] ) ) as SiteDetails[];
				const site = sites.find( ( candidate ) => candidate.id === id );
				ipcApi.showErrorMessageBox( {
					title: site
						? sprintf( __( "Failed to start '%s'" ), site.name )
						: __( 'Failed to start site' ),
					message:
						error instanceof Error
							? error.message
							: __(
									'Please restart Studio and try again. If this problem persists, please contact support.'
							  ),
					error,
					showOpenLogs: true,
				} );
				throw error;
			}
		},

		async stopSite( id ) {
			await ipcApi.stopServer( id );
		},

		async updateSite( site, wpVersion ) {
			await ipcApi.updateSite( site, wpVersion );
		},

		async updateSitesSortOrder( updates ) {
			await ipcApi.updateSitesSortOrder( updates );
		},

		async refreshSiteIcon( siteId ) {
			await ipcApi.loadSiteIcon( siteId );
		},

		async getSiteOverviewDetails( siteId ): Promise< SiteOverviewDetails > {
			return parseSiteOverviewDetails(
				await executeWpCli( siteId, SITE_OVERVIEW_DETAILS_COMMAND )
			);
		},

		async scaffoldPlugin( siteId, meta ) {
			return ( await ipcApi.scaffoldPlugin( { siteId, meta } ) ) as {
				pluginDir: string;
				activated: boolean;
			};
		},

		async getSiteThumbnail( siteId ): Promise< string | null > {
			return ( await ipcApi.getThumbnailData( siteId ) ) as string | null;
		},
		async getSiteStorageUsage( siteId ) {
			return ipcApi.getSiteStorageUsage( siteId );
		},

		async getXdebugEnabledSite() {
			return ( await ipcApi.getXdebugEnabledSite() ) as SiteDetails | null;
		},

		async isCertificateTrusted() {
			return ( await ipcApi.isCATrusted() ) as boolean;
		},

		async trustCertificate() {
			await ipcApi.trustCertificate();
		},

		async openSiteFileInEditor( siteId, relativePath ) {
			ipcApi.openFileInIDE( relativePath, siteId );
		},

		async openSiteDebugLog( siteId ) {
			const logPath = ( await ipcApi.getAbsolutePathFromSite( siteId, 'wp-content/debug.log' ) ) as
				| string
				| null;
			if ( logPath ) {
				ipcApi.openLocalPath( logPath );
			}
		},

		async getAgentInstructionsStatus( siteId ) {
			return ( await ipcApi.getAgentInstructionsStatus( siteId ) ) as InstructionFileStatus[];
		},

		async installAgentInstructions( siteId, options ) {
			await ipcApi.installAgentInstructions( siteId, options );
		},

		async removeAgentInstruction( siteId, fileType ) {
			await ipcApi.removeAgentInstruction( siteId, fileType );
		},

		async getWordPressSkillsStatus( siteId ) {
			return ( await ipcApi.getWordPressSkillsStatus( siteId ) ) as SkillStatus[];
		},

		async installWordPressSkillById( siteId, skillId ) {
			await ipcApi.installWordPressSkillById( siteId, skillId );
		},

		async removeWordPressSkillById( siteId, skillId ) {
			await ipcApi.removeWordPressSkillById( siteId, skillId );
		},

		async exportFullSite( siteId ): Promise< string | null > {
			const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
			const site = sites.find( ( candidate ) => candidate.id === siteId );
			if ( ! site ) {
				throw new Error( `Site ${ siteId } not found` );
			}
			const fileName = generateBackupFilename( site.name );
			const backupFile = ( await ipcApi.showSaveAsDialog( {
				title: __( 'Save backup file' ),
				defaultPath: `${ fileName }.zip`,
				filters: [
					{
						name: 'Compressed Backup Files',
						extensions: [ 'tar.gz', 'tzg', 'zip' ],
					},
				],
			} ) ) as string;
			if ( ! backupFile ) {
				return null;
			}
			// Success notification and error modal are shown by the main-process
			// handler, mirroring the legacy renderer's export flow.
			await ipcApi.exportSite( site.id, backupFile, {
				mode: 'full',
				showItemInFolder: true,
				showNotification: true,
			} );
			return backupFile;
		},

		async exportDatabase( siteId ): Promise< string | null > {
			const sites = ( await ipcApi.getSiteDetails() ) as SiteDetails[];
			const site = sites.find( ( candidate ) => candidate.id === siteId );
			if ( ! site ) {
				throw new Error( `Site ${ siteId } not found` );
			}
			const fileName = generateBackupFilename( site.name );
			const backupFile = ( await ipcApi.showSaveAsDialog( {
				title: __( 'Save database file' ),
				defaultPath: `${ fileName }.sql`,
				filters: [
					{
						name: 'SQL dump file',
						extensions: [ 'sql' ],
					},
				],
			} ) ) as string;
			if ( ! backupFile ) {
				return null;
			}
			await ipcApi.exportSite( site.id, backupFile, {
				mode: 'db',
				showItemInFolder: true,
				showNotification: true,
			} );
			return backupFile;
		},

		// Preview snapshots
		async getSnapshots(): Promise< Snapshot[] > {
			return ( await ipcApi.fetchSnapshots() ) as Snapshot[];
		},

		async getSnapshotUsage(): Promise< SnapshotUsage | null > {
			const data = await fetchWpcomJson(
				'https://public-api.wordpress.com/wpcom/v2/jurassic-ninja/usage',
				'snapshot usage'
			);
			return data === null ? null : parseSnapshotUsage( data );
		},

		async getStudioAssistantQuota(): Promise< StudioAssistantQuota | null > {
			const data = await fetchWpcomJson( STUDIO_ASSISTANT_QUOTA_URL, 'Studio assistant quota' );
			return data === null ? null : studioAssistantQuotaSchema.parse( data );
		},

		async deleteAllSnapshots(): Promise< void > {
			await ipcApi.deleteAllSnapshots();
		},

		async publishPreviewSite( siteId, existingHostname ): Promise< { url: string } > {
			const siteFolder = await resolveSiteFolder( siteId );
			// Reuses the desktop app's `createSnapshot`/`updateSnapshot` IPC
			// pair. Those kick off a CLI command and immediately return an
			// operationId; the actual completion is reported later via the
			// `snapshot-*` event channel, so we correlate by operationId and
			// resolve once the matching `snapshot-success` fires.
			const { operationId } = ( await ( existingHostname
				? ipcApi.updateSnapshot( siteFolder, existingHostname )
				: ipcApi.createSnapshot( siteFolder ) ) ) as { operationId: string };
			return awaitSnapshotOperation( operationId );
		},

		// Connected WPCom sites
		async getConnectedWpcomSites( localSiteId: string ): Promise< SyncSite[] > {
			return ( await ipcApi.getConnectedWpcomSites( localSiteId ) ) as SyncSite[];
		},

		async fetchSyncableWpcomSites(): Promise< SyncSite[] > {
			return ( await ipcApi.fetchSyncableWpcomSites() ) as SyncSite[];
		},

		async fetchSyncableWpcomSitesPage( options ): Promise< SyncableWpcomSitesPage > {
			return ( await ipcApi.fetchSyncableWpcomSitesPage( options ) ) as SyncableWpcomSitesPage;
		},

		async connectWpcomSite( localSiteId, site ): Promise< void > {
			await ipcApi.connectWpcomSites( [ { sites: [ site ], localSiteId } ] );
		},

		async disconnectWpcomSite( localSiteId, remoteSiteId ): Promise< void > {
			await ipcApi.disconnectWpcomSites( [ { siteIds: [ remoteSiteId ], localSiteId } ] );
		},

		onSyncConnectSite( listener ) {
			return ipcListener.subscribe(
				'sync-connect-site',
				(
					_event: unknown,
					payload: { remoteSiteId: number; studioSiteId: string; autoOpenPush?: boolean }
				) => listener( payload )
			);
		},

		async pushSiteToLive( siteId, remoteSiteId, options ): Promise< void > {
			// Mirrors the desktop app's `pushSiteThunk` — export a backup, then
			// TUS-upload it + initiate the remote import. We skip the
			// post-upload polling that the desktop app uses for progress UI;
			// `pushArchive` only resolves after `import/initiate` succeeds, so
			// the remote import may still be running when this returns.
			const operationId = window.crypto.randomUUID();
			const { archivePath } = ( await ipcApi.exportSiteForPush( siteId, operationId, {
				optionsToSync: options?.optionsToSync,
				specificSelectionPaths: options?.specificSelectionPaths,
			} ) ) as { archivePath: string };
			const result = ( await ipcApi.pushArchive(
				siteId,
				remoteSiteId,
				archivePath,
				options?.optionsToSync,
				options?.specificSelectionPaths
			) ) as { success: boolean; error?: string };
			if ( ! result.success ) {
				throw new Error( result.error ?? 'Push failed' );
			}
			await markConnectedWpcomSiteSynced( siteId, remoteSiteId, 'push' );
		},

		async pullSiteFromLive( siteId, remoteSiteId, optionsOrProgress, onProgress ): Promise< void > {
			const options = typeof optionsOrProgress === 'function' ? undefined : optionsOrProgress;
			const progressCallback =
				typeof optionsOrProgress === 'function' ? optionsOrProgress : onProgress;
			const unsubscribe = progressCallback
				? ipcListener.subscribe(
						'sync-pull-progress',
						(
							_event: unknown,
							payload: { siteId: string; message: string; progress?: number }
						) => {
							if ( payload.siteId === siteId ) {
								progressCallback( {
									message: payload.message,
									...( payload.progress === undefined ? {} : { progress: payload.progress } ),
								} );
							}
						}
				  )
				: undefined;
			try {
				if ( options ) {
					await ipcApi.pullSiteFromLive(
						siteId,
						remoteSiteId,
						options.optionsToSync,
						options.includePathList
					);
				} else {
					await ipcApi.pullSiteFromLive( siteId, remoteSiteId );
				}
			} finally {
				unsubscribe?.();
			}
			await markConnectedWpcomSiteSynced( siteId, remoteSiteId, 'pull' );
		},

		async getLiveSyncItems( siteId, remoteSiteId, direction ) {
			return ipcApi.getLiveSyncItems( siteId, remoteSiteId, direction );
		},

		async getLiveSyncImportStatus( remoteSiteId ) {
			return ipcApi.getLiveSyncImportStatus( remoteSiteId );
		},

		async getLiveSyncLatestBackupTime( remoteSiteId ) {
			return ipcApi.getLiveSyncLatestBackupTime( remoteSiteId );
		},

		async markLiveSiteSynced( localSiteId, remoteSiteId, direction ) {
			await markConnectedWpcomSiteSynced( localSiteId, remoteSiteId, direction );
		},

		getPublishCheckoutUrl( site ): string {
			return buildPublishCheckoutUrl( site );
		},

		// AI sessions
		async getSessions(): Promise< AiSessionSummary[] > {
			return ( await ipcApi.listAiSessions() ) as AiSessionSummary[];
		},

		async getSession( sessionId ): Promise< LoadedAiSession > {
			return ( await ipcApi.loadAiSession( sessionId ) ) as LoadedAiSession;
		},

		async deleteSession( sessionId ) {
			await ipcApi.deleteAiSession( sessionId );
		},

		async updateSessionMetadata( sessionId, patch ): Promise< AiSessionSummary > {
			return ( await ipcApi.updateAiSessionMetadata( sessionId, patch ) ) as AiSessionSummary;
		},

		async createSession( siteId ): Promise< AiSessionSummary > {
			return ( await ipcApi.createAiSession( siteId ) ) as AiSessionSummary;
		},

		async continueSession( sessionId, prompt, options ): Promise< { runId: string } > {
			return ( await ipcApi.continueAiSession( sessionId, prompt, options ) ) as {
				runId: string;
			};
		},

		async getActiveAgentRuns(): Promise< ActiveAgentRun[] > {
			return ( await ipcApi.listActiveAiAgentRuns() ) as ActiveAgentRun[];
		},

		async setSessionModel( sessionId, model ) {
			await ipcApi.setAiSessionModel( sessionId, model );
		},

		async interruptAgentRun( runId ) {
			await ipcApi.interruptAiAgentRun( runId );
		},

		async answerAgentQuestion( runId, answers ) {
			await ipcApi.answerAiAgentQuestion( runId, answers );
		},

		async answerAgentPermission( runId, requestId, decision ) {
			await ipcApi.answerAiAgentPermission( runId, requestId, decision );
		},

		async setSessionEnvironment( sessionId, environment ) {
			const result = ( await ipcApi.setSessionEnvironment( sessionId, environment ) ) as {
				environment: 'local' | 'live';
				url?: string;
				wpcomSiteId?: number;
			};
			return {
				environment: result.environment,
				url: result.url,
				wpcomSiteId: result.wpcomSiteId,
			};
		},

		onAgentEvent( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'ai-agent-event', ( _event: unknown, payload: AgentRunEvent ) =>
				listener( payload )
			);
		},

		onSessionPlacementUpdated( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe(
				'ai-session-placement-updated',
				( _event: unknown, payload: AiSessionPlacementUpdatedEvent ) => listener( payload )
			);
		},

		async showChatNotification( notification ) {
			const { sessionId, title, body } = notification;
			ipcApi.showChatNotification( { sessionId, title, body } );
		},

		onChatNotificationClicked( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe(
				'chat-notification-clicked',
				( _event: unknown, payload: { sessionId: string } ) => listener( payload )
			);
		},

		// User preferences — the underlying main-process handlers are split
		// per field; we fan out in parallel here so the UI can work with a
		// single query/mutation pair.
		async getUserPreferences(): Promise< UserPreferences > {
			const [
				editor,
				terminal,
				colorScheme,
				frameColor,
				locale,
				analyticsEnabled,
				defaultSiteDirectory,
				studioCliInstalled,
				studioCliExternallyManaged,
				agenticFeaturesEnabled,
				chatNotificationsEnabled,
				activitySoundPreferences,
				quitSitesBehavior,
				agentResponseLength,
				defaultAiModel,
				toolPermissions,
			] = ( await Promise.all( [
				ipcApi.getUserEditor(),
				ipcApi.getUserTerminal(),
				ipcApi.getColorScheme(),
				ipcApi.getFrameColor(),
				ipcApi.getUserLocale(),
				ipcApi.getAnalyticsEnabled(),
				ipcApi.getDefaultSiteDirectory(),
				ipcApi.isStudioCliInstalled(),
				ipcApi.isStudioCliExternallyManaged(),
				ipcApi.getAgenticFeaturesEnabled(),
				ipcApi.getChatNotificationsEnabled(),
				ipcApi.getActivitySoundPreferences(),
				ipcApi.getQuitSitesBehavior(),
				ipcApi.getAgentResponseLength(),
				ipcApi.getDefaultAiModel(),
				ipcApi.getToolPermissions(),
			] ) ) as [
				SupportedEditor | null,
				SupportedTerminal | null,
				ColorScheme,
				string | null,
				string | undefined,
				boolean,
				string,
				boolean,
				boolean,
				boolean,
				boolean,
				unknown,
				QuitSitesBehavior | undefined,
				AiResponseLength,
				AiModelId,
				ToolPermissionOverrides,
			];
			return {
				editor,
				terminal,
				colorScheme,
				frameColor,
				locale,
				analyticsEnabled,
				defaultSiteDirectory,
				studioCliInstalled,
				studioCliExternallyManaged,
				agenticFeaturesEnabled,
				chatNotificationsEnabled,
				activitySoundPreferences: resolveActivitySoundPreferences( activitySoundPreferences ),
				// The desktop stores "ask" as an absent key; surface it as the
				// explicit 'ask' member the settings UI works with.
				quitSitesBehavior: quitSitesBehavior ?? 'ask',
				agentResponseLength,
				defaultAiModel,
				toolPermissions,
			};
		},

		async setUserPreferences( partial, source ): Promise< void > {
			const writes: Array< Promise< unknown > > = [];
			if ( 'editor' in partial ) {
				writes.push( ipcApi.saveUserEditor( partial.editor ) );
			}
			if ( 'terminal' in partial ) {
				writes.push( ipcApi.saveUserTerminal( partial.terminal ) );
			}
			if ( 'colorScheme' in partial && partial.colorScheme ) {
				writes.push( ipcApi.saveColorScheme( partial.colorScheme ) );
			}
			if ( 'frameColor' in partial ) {
				writes.push( ipcApi.saveFrameColor( partial.frameColor ?? null ) );
			}
			if ( 'locale' in partial && partial.locale ) {
				writes.push( ipcApi.saveUserLocale( partial.locale ) );
			}
			if ( 'analyticsEnabled' in partial ) {
				writes.push(
					ipcApi.saveAnalyticsEnabled( partial.analyticsEnabled, {
						surface: source?.surface ?? 'settings',
					} )
				);
			}
			if ( 'defaultSiteDirectory' in partial && partial.defaultSiteDirectory ) {
				writes.push( ipcApi.saveDefaultSiteDirectory( partial.defaultSiteDirectory ) );
			}
			if ( 'studioCliInstalled' in partial && typeof partial.studioCliInstalled === 'boolean' ) {
				writes.push(
					partial.studioCliInstalled ? ipcApi.installStudioCli() : ipcApi.uninstallStudioCli()
				);
			}
			if (
				'agenticFeaturesEnabled' in partial &&
				typeof partial.agenticFeaturesEnabled === 'boolean'
			) {
				writes.push( ipcApi.saveAgenticFeaturesEnabled( partial.agenticFeaturesEnabled ) );
			}
			if (
				'chatNotificationsEnabled' in partial &&
				typeof partial.chatNotificationsEnabled === 'boolean'
			) {
				writes.push( ipcApi.saveChatNotificationsEnabled( partial.chatNotificationsEnabled ) );
			}
			if ( 'activitySoundPreferences' in partial && partial.activitySoundPreferences ) {
				writes.push( ipcApi.saveActivitySoundPreferences( partial.activitySoundPreferences ) );
			}
			if ( 'quitSitesBehavior' in partial && partial.quitSitesBehavior ) {
				writes.push(
					ipcApi.saveQuitSitesBehavior(
						partial.quitSitesBehavior === 'ask' ? undefined : partial.quitSitesBehavior
					)
				);
			}
			if ( 'agentResponseLength' in partial && partial.agentResponseLength ) {
				writes.push( ipcApi.saveAgentResponseLength( partial.agentResponseLength ) );
			}
			if ( 'defaultAiModel' in partial && partial.defaultAiModel ) {
				writes.push( ipcApi.saveDefaultAiModel( partial.defaultAiModel ) );
			}
			if ( 'toolPermissions' in partial && partial.toolPermissions ) {
				for ( const [ toolName, level ] of Object.entries( partial.toolPermissions ) ) {
					if ( level ) {
						writes.push( ipcApi.saveToolPermission( toolName, level ) );
					}
				}
			}
			await Promise.all( writes );
		},

		async previewColorScheme( colorScheme ): Promise< void > {
			await ipcApi.previewColorScheme( colorScheme );
		},

		async selectDefaultSiteDirectory( defaultPath ): Promise< string | null > {
			const response = ( await ipcApi.showOpenFolderDialog(
				__( 'Select default site directory' ),
				defaultPath
			) ) as { path?: string } | null;
			return response?.path ?? null;
		},

		async getAppGlobals() {
			return ipcApi.getAppGlobals();
		},

		onUserSettings( listener ) {
			return ipcListener.subscribe(
				'user-settings',
				( _event: unknown, payload: { tabName?: UserSettingsEventTab } ) =>
					listener( payload?.tabName )
			);
		},

		async getAgentInstructions(): Promise< string > {
			return ( await ipcApi.getGlobalAgentInstructions() ) as string;
		},
		async saveAgentInstructions( content: string ): Promise< void > {
			await ipcApi.saveGlobalAgentInstructions( content );
		},

		async getInstalledApps(): Promise< InstalledApps > {
			return ( await ipcApi.getInstalledAppsAndTerminals() ) as InstalledApps;
		},

		async fetchSiteRest( siteId, request ) {
			return await ipcApi.fetchSiteRestApi( siteId, request );
		},

		async openSiteFolder( siteId ): Promise< void > {
			const sitePath = await resolveSiteFolder( siteId );
			ipcApi.openLocalPath( sitePath );
		},

		async openSiteInEditor( siteId ): Promise< void > {
			const sitePath = await resolveSiteFolder( siteId );
			const editor = ( await ipcApi.getUserEditor() ) as SupportedEditor | null;
			if ( ! editor ) {
				throw new Error( 'No preferred editor configured.' );
			}
			// Emit here rather than in Main's `openAppAtPath`, which is shared with single-file opens.
			void ipcApi.recordAnalyticsEvent( TRACKS_EVENTS.SITE_OPEN_IN_EDITOR, { editor } );
			await ipcApi.openAppAtPath( editor, sitePath );
		},

		async openSiteInTerminal( siteId ): Promise< void > {
			const sitePath = await resolveSiteFolder( siteId );
			await ipcApi.openTerminalAtPath( sitePath );
		},

		async openStudioLogs(): Promise< void > {
			ipcApi.openStudioLogs();
		},

		// Analytics. `channel` and `ui_version` are attached by the desktop Tracks wrapper's
		// `commonProps()` in Main, so callers pass only event-specific props here.
		async trackEvent( eventName, props = {} ): Promise< void > {
			await ipcApi.recordAnalyticsEvent( eventName, { ...props } );
		},

		// External links
		async openExternalUrl( url: string ): Promise< void > {
			ipcApi.openURL( url );
		},

		async getWapuuScore(): Promise< number | undefined > {
			return ( await ipcApi.getWapuuScore() ) as number | undefined;
		},
		async saveWapuuScore( score: number ): Promise< void > {
			await ipcApi.saveWapuuScore( score );
		},

		async popupAppMenu( position: { x: number; y: number } ): Promise< void > {
			ipcApi.popupAppMenu( position );
		},

		// Windows/Linux have no native menu bar, so the UI provides the entry
		// point; macOS keeps the native application menu.
		showsAppMenuButton: ! isMacOS,

		async copyText( text: string ): Promise< void > {
			await ipcApi.copyText( text );
		},

		async copyImage( pngDataUrl: string ): Promise< void > {
			await ipcApi.copyImage( pngDataUrl );
		},

		async showTextContextMenu( context ) {
			return ipcApi.showTextContextMenu( context );
		},

		async openSiteUrl( siteId, relativeUrl = '', options ): Promise< void > {
			await ipcApi.openSiteURL( siteId, relativeUrl, options );
		},

		async confirmDeleteAllPreviewSites(): Promise< boolean > {
			const CANCEL_BUTTON_INDEX = 0;
			const DELETE_BUTTON_INDEX = 1;
			const { response } = ( await ipcApi.showMessageBox( {
				type: 'warning',
				message: __( 'Delete all preview sites' ),
				detail: __(
					'All preview sites that exist for your WordPress.com account, along with all posts, pages, comments, and media, will be lost.'
				),
				buttons: [ __( 'Cancel' ), __( 'Delete all' ) ],
				cancelId: CANCEL_BUTTON_INDEX,
			} ) ) as { response: number };
			return response === DELETE_BUTTON_INDEX;
		},

		async getWordPressSkillsStatusAllSites(): Promise< SkillStatus[] > {
			return ( await ipcApi.getWordPressSkillsStatusAllSites() ) as SkillStatus[];
		},

		async installWordPressSkillToAllSites( skillId ): Promise< void > {
			await ipcApi.installWordPressSkillsToAllSites( { skillId } );
		},

		async removeWordPressSkillFromAllSites( skillId ): Promise< void > {
			await ipcApi.removeWordPressSkillFromAllSites( skillId );
		},

		// Window state
		// macOS overlays the traffic lights on the content (so we reserve
		// space for them); Windows and Linux don't.
		reservesTrafficLightSpace: isMacOS,

		async isFullscreen(): Promise< boolean > {
			return ipcApi.isFullscreen();
		},

		async expandWindowForWorkbench(): Promise< void > {
			await ipcApi.expandWindowForWorkbench();
		},

		onFullscreenChange( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe(
				'window-fullscreen-change',
				( _event: unknown, fullscreen: boolean ) => listener( fullscreen )
			);
		},

		onSiteEvent( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'site-event', ( _event: unknown, siteEvent: SiteEvent ) =>
				listener( siteEvent )
			);
		},

		onToggleSitePreview( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'toggle-site-preview', () => listener() );
		},

		onToggleSidebar( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'toggle-sidebar', () => listener() );
		},

		async getDismissedMessages() {
			return ipcApi.getDismissedMessages();
		},

		async dismissMessage( id ) {
			await ipcApi.dismissMessage( id );
		},

		async getOnboardingHints() {
			return ipcApi.getOnboardingHints();
		},

		async setOnboardingHints( partial ) {
			await ipcApi.saveOnboardingHints( partial );
		},

		onOpenSettings( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'user-settings', () => listener() );
		},

		onShowGettingStarted( listener ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const ipcListener = ( window as any ).ipcListener;
			return ipcListener.subscribe( 'show-getting-started', () => listener() );
		},

		async disableAgenticUi(): Promise< void > {
			await ipcApi.disableAgenticUi();
		},

		onShowWhatsNew( listener ) {
			return ipcListener.subscribe( 'show-whats-new', () => listener() );
		},

		async getLastSeenVersion() {
			return ipcApi.getLastSeenVersion();
		},

		async saveLastSeenVersion( version ) {
			await ipcApi.saveLastSeenVersion( version );
		},

		async getAppUpdateStatus() {
			return ipcApi.getAppUpdateStatus();
		},

		async installAppUpdate(): Promise< void > {
			await ipcApi.installAppUpdate();
		},

		onAppUpdateStatusChanged( listener ) {
			return ipcListener.subscribe( 'app-update-status', ( _event: unknown, status: unknown ) =>
				listener( status as AppUpdateStatus )
			);
		},
	};
}
