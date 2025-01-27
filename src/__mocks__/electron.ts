export const ipcMain = {
	emit: jest.fn(),
	on: jest.fn(),
	handle: jest.fn(),
};

export const app = {
	getFetch: jest.fn(),
	getPath: jest.fn( ( name ) => `/path/to/app/${ name }` ),
	getName: jest.fn( () => 'App Name' ),
	getLocale: jest.fn( () => 'en-US' ),
	setName: jest.fn(),
	getVersion: jest.fn( () => '0.0.0' ),
	getPreferredSystemLanguages: jest.fn( () => [ 'en-US' ] ),
	requestSingleInstanceLock: jest.fn( () => true ),
	on: jest.fn(),
	setAppLogsPath: jest.fn(),
	setAsDefaultProtocolClient: jest.fn(),
	enableSandbox: jest.fn(),
	commandLine: {
		hasSwitch: jest.fn( () => false ),
		getSwitchValue: jest.fn(),
	},
	getSystemLocale: jest.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function BrowserWindow() {}
BrowserWindow.prototype.loadURL = jest.fn();
BrowserWindow.prototype.isDestroyed = jest.fn( () => false );
BrowserWindow.prototype.on = jest.fn();
BrowserWindow.prototype.webContents = {
	on: jest.fn(),
	send: jest.fn(),
	isDestroyed: jest.fn( () => false ),
};
BrowserWindow.fromWebContents = jest.fn( () => ( {
	isDestroyed: jest.fn( () => false ),
	webContents: {
		isDestroyed: jest.fn( () => false ),
		send: jest.fn(),
	},
} ) );
BrowserWindow.getAllWindows = jest.fn( () => [] );
BrowserWindow.getFocusedWindow = jest.fn();

const eventHandlers: { [ key: string ]: Array< ( ...args: any[] ) => void > } = {};
BrowserWindow.prototype.on = jest.fn( ( event: string, handler: ( ...args: any[] ) => void ) => {
	if ( ! eventHandlers[ event ] ) {
		eventHandlers[ event ] = [];
	}
	eventHandlers[ event ].push( handler );
} );
BrowserWindow.prototype.emit = jest.fn( ( event: string, ...args: any[] ) => {
	const handlers = eventHandlers[ event ] || [];
	handlers.forEach( ( handler ) => handler( ...args ) );
} );

export const Menu = {
	buildFromTemplate: jest.fn(),
	setApplicationMenu: jest.fn(),
};

export const shell = {
	openExternal: jest.fn(),
	trashItem: jest.fn(),
};

export const autoUpdater = {
	setFeedURL: jest.fn(),
	on: jest.fn(),
};

export const session = {
	defaultSession: {
		setPermissionRequestHandler: jest.fn(),
		webRequest: {
			onHeadersReceived: jest.fn(),
		},
	},
};
