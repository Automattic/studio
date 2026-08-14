// Store the actions in a separate file to avoid Webpack issues when importing them in the Studio
// source code

export enum AuthCommandLoggerAction {
	LOGIN = 'login',
	LOGOUT = 'logout',
	STATUS_CHECK = 'status_check',
}

export enum PreviewCommandLoggerAction {
	VALIDATE = 'validate',
	ARCHIVE = 'archive',
	LOAD = 'load',
	DELETE = 'delete',
	DELETE_ALL = 'deleteAll',
	UPLOAD = 'upload',
	READY = 'ready',
	APPDATA = 'appdata',
	SET = 'set',
}

export enum SiteCommandLoggerAction {
	START_DAEMON = 'startDaemon',
	LOAD_SITES = 'loadSites',
	START_PROXY = 'startProxy',
	STOP_PROXY = 'stopProxy',
	GENERATE_CERT = 'generateCert',
	DELETE_CERT = 'deleteCert',
	ADD_DOMAIN_TO_HOSTS = 'addDomainToHosts',
	REMOVE_DOMAIN_FROM_HOSTS = 'removeDomainFromHosts',
	START_SITE = 'startSite',
	STOP_SITE = 'stopSite',
	STOP_ALL_SITES = 'stopAllSites',
	SET_WP_VERSION = 'setWpVersion',
	VALIDATE = 'validate',
	CREATE_DIRECTORY = 'createDirectory',
	INSTALL_SQLITE = 'installSqlite',
	ASSIGN_PORT = 'assignPort',
	SETUP_WORDPRESS = 'setupWordPress',
	SAVE_SITE = 'saveSite',
	APPLY_BLUEPRINT = 'applyBlueprint',
	EXTRACT_BACKUP = 'extractBackup',
	IMPORT_SITE = 'importSite',
	IMPORT_DATABASE = 'importDatabase',
	IMPORT_WP_CONTENT = 'importWpContent',
	IMPORT_META = 'importMeta',
	EXPORT_SITE = 'exportSite',
	CREATE_BACKUP = 'createBackup',
	EXPORT_DATABASE = 'exportDatabase',
	EXPORT_WP_CONTENT = 'exportWpContent',
	EXPORT_CONFIG = 'exportConfig',
	DELETE_PREVIEW_SITES = 'deletePreviewSites',
	DELETE_FILES = 'deleteFiles',
	CHECKING_DEPENDENCY_UPDATES = 'checkingDependencyUpdates',
	ENSURE_PHP_BINARY = 'ensurePhpBinary',
}

export enum PullReprintCommandLoggerAction {
	LOAD_SITES = 'loadSites',
	PREFLIGHT = 'preflight',
	LOAD_WPCOM_SITES = 'loadWpComSites',
	ROTATE_SECRET = 'rotateSecret',
	ABORT_IMPORT = 'abortImport',
	CREATE_SITE = 'createSite',
	DOWNLOAD_FILES = 'downloadFiles',
	DOWNLOAD_SQL = 'downloadSql',
	START_SITE = 'startSite',
	IMPORT_SQL = 'importSql',
	URL_REWRITE = 'urlRewrite',
}

export enum BlueprintCommandLoggerAction {
	FETCH_BLUEPRINTS = 'fetchBlueprints',
	FETCH_BLUEPRINT = 'fetchBlueprint',
	DOWNLOAD_BUNDLE = 'downloadBundle',
}

export enum SyncCommandLoggerAction {
	START_DAEMON = 'startDaemon',
	STOP_SITE = 'stopSite',
	LOAD_SITES = 'loadSites',
	INSTALL_SQLITE = 'installSqlite',
	FETCH_REMOTE_SITES = 'fetchRemoteSites',
	ARCHIVE = 'archive',
	UPLOAD = 'upload',
	INITIATE_IMPORT = 'initiateImport',
	POLL_IMPORT = 'pollImport',
	INITIATE_BACKUP = 'initiateBackup',
	POLL_BACKUP = 'pollBackup',
	START_SITE = 'startSite',
	DOWNLOAD = 'download',
	IMPORT = 'import',
}
