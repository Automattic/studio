export const app = {
	getFetch: jest.fn(),
	getPath: jest.fn( ( name ) => `/path/to/app/${ name }` ),
	getName: jest.fn( () => 'App Name' ),
	getLocale: jest.fn( () => 'en-US' ),
};

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function BrowserWindow() {}
BrowserWindow.prototype.loadURL = jest.fn();
BrowserWindow.prototype.isDestroyed = jest.fn( () => false );
BrowserWindow.prototype.on = jest.fn();
BrowserWindow.prototype.webContents = {
	on: jest.fn(),
	send: jest.fn(),
};
BrowserWindow.fromWebContents = jest.fn( () => ( {
	isDestroyed: jest.fn( () => false ),
	webContents: {
		send: jest.fn(),
	},
} ) );
BrowserWindow.getAllWindows = jest.fn( () => [] );
BrowserWindow.getFocusedWindow = jest.fn();

export const Menu = {
	buildFromTemplate: jest.fn(),
	setApplicationMenu: jest.fn(),
};

export const shell = {
	openExternal: jest.fn(),
	trashItem: jest.fn(),
};
