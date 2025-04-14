// Store the actions in a separate file to avoid Webpack issues when importing them in the Studio
// source code

export enum CreateLoggerAction {
	VALIDATE = 'validate',
	ARCHIVE = 'archive',
	UPLOAD = 'upload',
	READY = 'ready',
	APPDATA = 'appdata',
}

export enum DeleteLoggerAction {
	VALIDATE = 'validate',
	DELETE = 'delete',
}

export enum ListLoggerAction {
	VALIDATE = 'validate',
	LOAD = 'load',
}

export enum UpdateLoggerAction {
	VALIDATE = 'validate',
	ARCHIVE = 'archive',
	UPLOAD = 'upload',
	READY = 'ready',
	APPDATA = 'appdata',
}
