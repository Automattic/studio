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
	GENERATE_CERT = 'generateCert',
	ADD_DOMAIN_TO_HOSTS = 'addDomainToHosts',
	START_SITE = 'startSite',
}
