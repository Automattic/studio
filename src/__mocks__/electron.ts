export const app = {
	getFetch: jest.fn(),
	getPath: jest.fn( ( name ) => `/path/to/app/${ name }` ),
	getName: jest.fn( () => 'App Name' ),
	getPreferredSystemLanguages: jest.fn( () => [ 'en-US' ] ),
};

export const BrowserWindow = {
	fromWebContents: jest.fn( () => ( {
		webContents: {
			send: jest.fn(),
		},
	} ) ),
};

export const shell = {
	openExternal: jest.fn(),
	trashItem: jest.fn(),
};
