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
	UPLOAD = 'upload',
	READY = 'ready',
	APPDATA = 'appdata',
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
	DELETE_PREVIEW_SITES = 'deletePreviewSites',
	DELETE_FILES = 'deleteFiles',
}

export enum ImportCommandLoggerAction {
	PREFLIGHT = 'preflight',
	CREATE_SITE = 'createSite',
	DOWNLOAD_FILES = 'downloadFiles',
	DOWNLOAD_SQL = 'downloadSql',
	START_SITE = 'startSite',
	IMPORT_SQL = 'importSql',
	URL_REWRITE = 'urlRewrite',
}
