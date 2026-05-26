/// <reference types="vitest/globals" />

export const ipcMain = {
	emit: vi.fn(),
	on: vi.fn(),
	handle: vi.fn(),
};

export const app = {
	getFetch: vi.fn(),
	getAppPath: vi.fn( () => '/path/to/app' ),
	getPath: vi.fn( ( name ) => `/path/to/app/${ name }` ),
	getName: vi.fn( () => 'App Name' ),
	getLocale: vi.fn( () => 'en-US' ),
	setName: vi.fn(),
	getVersion: vi.fn( () => '0.0.0' ),
	getPreferredSystemLanguages: vi.fn( () => [ 'en-US' ] ),
	requestSingleInstanceLock: vi.fn( () => true ),
	on: vi.fn(),
	off: vi.fn(),
	setAppLogsPath: vi.fn(),
	setAsDefaultProtocolClient: vi.fn(),
	enableSandbox: vi.fn(),
	commandLine: {
		hasSwitch: vi.fn( () => false ),
		getSwitchValue: vi.fn(),
	},
	getSystemLocale: vi.fn(),
};

export function BrowserWindow() {}
BrowserWindow.prototype.loadURL = vi.fn();
BrowserWindow.prototype.loadFile = vi.fn();
BrowserWindow.prototype.isDestroyed = vi.fn( () => false );
BrowserWindow.prototype.on = vi.fn();
BrowserWindow.prototype.getBounds = vi.fn( () => ( { x: 0, y: 0, width: 800, height: 600 } ) );
BrowserWindow.prototype.setFullScreen = vi.fn();
BrowserWindow.prototype.isFullScreen = vi.fn( () => false );

const mockWebContents = {
	on: vi.fn(),
	once: vi.fn(),
	send: vi.fn(),
	isDestroyed: vi.fn( () => false ),
};

BrowserWindow.prototype.webContents = mockWebContents;

BrowserWindow.fromWebContents = vi.fn( () => ( {
	isDestroyed: vi.fn( () => false ),
	webContents: mockWebContents,
} ) );

BrowserWindow.getAllWindows = vi.fn( () => [] );
BrowserWindow.getFocusedWindow = vi.fn();

const eventHandlers: { [ key: string ]: Array< ( ...args: any[] ) => void > } = {};
BrowserWindow.prototype.on = vi.fn( ( event: string, handler: ( ...args: any[] ) => void ) => {
	if ( ! eventHandlers[ event ] ) {
		eventHandlers[ event ] = [];
	}
	eventHandlers[ event ].push( handler );
} );
BrowserWindow.prototype.emit = vi.fn( ( event: string, ...args: any[] ) => {
	const handlers = eventHandlers[ event ] || [];
	handlers.forEach( ( handler ) => handler( ...args ) );
} );

export const dialog = {
	showMessageBox: vi.fn(),
};

export const Menu = {
	buildFromTemplate: vi.fn(),
	setApplicationMenu: vi.fn(),
};

export const shell = {
	openExternal: vi.fn(),
	openPath: vi.fn( async () => '' ),
	trashItem: vi.fn(),
};

export const autoUpdater = {
	setFeedURL: vi.fn(),
	on: vi.fn(),
};

export const clipboard = {
	writeText: vi.fn(),
};

export const session = {
	defaultSession: {
		setPermissionRequestHandler: vi.fn(),
		webRequest: {
			onBeforeSendHeaders: vi.fn(),
			onHeadersReceived: vi.fn(),
		},
	},
};

export const screen = {
	getAllDisplays: vi.fn( () => [
		{
			workArea: { x: 0, y: 0, width: 1920, height: 1080 },
		},
	] ),
};
