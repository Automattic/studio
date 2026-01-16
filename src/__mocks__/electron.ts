export const ipcMain = {
	emit: jest.fn(),
	on: jest.fn(),
	handle: jest.fn(),
};

export const app = {
	getFetch: jest.fn(),
	getAppPath: jest.fn( () => '/path/to/app' ),
	getPath: jest.fn( ( name ) => `/path/to/app/${ name }` ),
	getName: jest.fn( () => 'App Name' ),
	getLocale: jest.fn( () => 'en-US' ),
	setName: jest.fn(),
	getVersion: jest.fn( () => '0.0.0' ),
	getPreferredSystemLanguages: jest.fn( () => [ 'en-US' ] ),
	requestSingleInstanceLock: jest.fn( () => true ),
	on: jest.fn(),
	off: jest.fn(),
	setAppLogsPath: jest.fn(),
	setAsDefaultProtocolClient: jest.fn(),
	enableSandbox: jest.fn(),
	commandLine: {
		hasSwitch: jest.fn( () => false ),
		getSwitchValue: jest.fn(),
	},
	getSystemLocale: jest.fn(),
};

export function BrowserWindow() {}
BrowserWindow.prototype.loadURL = jest.fn();
BrowserWindow.prototype.loadFile = jest.fn();
BrowserWindow.prototype.isDestroyed = jest.fn( () => false );
BrowserWindow.prototype.on = jest.fn();
BrowserWindow.prototype.getBounds = jest.fn( () => ( { x: 0, y: 0, width: 800, height: 600 } ) );
BrowserWindow.prototype.setFullScreen = jest.fn();
BrowserWindow.prototype.isFullScreen = jest.fn( () => false );

const mockWebContents = {
	on: jest.fn(),
	once: jest.fn(),
	send: jest.fn(),
	isDestroyed: jest.fn( () => false ),
};

BrowserWindow.prototype.webContents = mockWebContents;

BrowserWindow.fromWebContents = jest.fn( () => ( {
	isDestroyed: jest.fn( () => false ),
	webContents: mockWebContents,
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

export const dialog = {
	showMessageBox: jest.fn(),
};

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

export const screen = {
	getAllDisplays: jest.fn( () => [
		{
			workArea: { x: 0, y: 0, width: 1920, height: 1080 },
		},
	] ),
};
