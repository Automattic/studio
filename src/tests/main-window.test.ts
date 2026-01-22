/**
 * @vitest-environment node
 */
import { BrowserWindow } from 'electron';
import fs from 'fs';
import { normalize } from 'path';
import { readFile } from 'atomically';
import { vi } from 'vitest';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { createMainWindow, getMainWindow, __resetMainWindow } from 'src/main-window';

vi.mock( 'fs' );
vi.mock( 'src/ipc-utils' );
vi.mock( 'atomically' );
vi.mock( 'src/lib/app-globals', () => ( {
	saveWindowBounds: vi.fn(),
} ) );
vi.mock( 'src/storage/paths', () => ( {
	getResourcesPath: vi.fn().mockReturnValue( '/mock/resources' ),
	getUserDataFilePath: vi.fn().mockReturnValue( '/mock/userdata.json' ),
	getUserDataLockFilePath: vi.fn().mockReturnValue( '/mock/userdata.json.lock' ),
	getUserDataCertificatesPath: vi.fn().mockReturnValue( '/mock/certificates' ),
	getServerFilesPath: vi.fn().mockReturnValue( '/mock/server/files' ),
	getCliPath: vi.fn().mockReturnValue( '/mock/cli/path' ),
	getBundledNodeBinaryPath: vi.fn().mockReturnValue( '/mock/node/binary' ),
	getSiteThumbnailPath: vi.fn().mockReturnValue( '/mock/thumbnail.png' ),
	DEFAULT_SITE_PATH: '/mock/default/site/path',
} ) );

// Create a simpler mock that tracks event handlers
const mockEventHandlers = new Map< string, ( ( ...args: any[] ) => void )[] >();

vi.mock( 'electron', () => {
	class MockBrowserWindow {
		static fromWebContents = vi.fn( () => new MockBrowserWindow() );
		static getFocusedWindow = vi.fn();
		static getAllWindows = vi.fn().mockReturnValue( [] );

		isDestroyed = vi.fn().mockReturnValue( false );
		isFullScreen = vi.fn().mockReturnValue( false );
		loadFile = vi.fn().mockResolvedValue( undefined );
		loadURL = vi.fn().mockResolvedValue( undefined );
		setBackgroundColor = vi.fn();
		getBounds = vi.fn().mockReturnValue( { x: 0, y: 0, width: 800, height: 600 } );

		on = vi.fn( ( event: string, handler: ( ...args: any[] ) => void ) => {
			if ( ! mockEventHandlers.has( event ) ) {
				mockEventHandlers.set( event, [] );
			}
			mockEventHandlers.get( event )!.push( handler );
		} );

		webContents = {
			isDestroyed: vi.fn().mockReturnValue( false ),
			send: vi.fn(),
			on: vi.fn( ( event: string, handler: ( ...args: any[] ) => void ) => {
				if ( event === 'did-finish-load' ) {
					// Call handler immediately to resolve window creation
					setImmediate( handler );
				}
			} ),
			once: vi.fn(),
			setWindowOpenHandler: vi.fn(),
		};
	}

	return {
		__esModule: true,
		app: {
			getVersion: vi.fn().mockReturnValue( '1.0.0' ),
			getPath: vi.fn().mockReturnValue( '/mock/path' ),
			isPackaged: false,
		},
		dialog: {
			showMessageBox: vi.fn(),
		},
		BrowserWindow: MockBrowserWindow,
		shell: {
			trashItem: vi.fn(),
		},
		Menu: vi.fn(),
		MenuItem: vi.fn(),
		clipboard: {
			writeText: vi.fn(),
		},
		Notification: vi.fn(),
	};
} );

const mockUserData = {
	sites: [],
};
if ( '__setFileContents' in fs ) {
	(
		fs as typeof fs & { __setFileContents: ( path: string, contents: string | string[] ) => void }
	 ).__setFileContents(
		normalize( '/path/to/app/appData/App Name/appdata-v1.json' ),
		JSON.stringify( mockUserData )
	);
}
vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( mockUserData ) ) );

describe( 'getMainWindow', () => {
	let createdWindow: BrowserWindow;

	beforeEach( async () => {
		createdWindow = await createMainWindow();
	} );

	afterEach( () => {
		__resetMainWindow();
	} );

	it( 'returns the main window when the reference is set', async () => {
		const window = await getMainWindow();
		expect( window ).toBe( createdWindow );
	} );

	it( 'returns the focused window when the reference is destroyed', async () => {
		const mockWindow1 = new BrowserWindow();
		const mockWindow2 = new BrowserWindow();
		vi.mocked( createdWindow.isDestroyed ).mockReturnValueOnce( true );
		vi.mocked( BrowserWindow.getFocusedWindow ).mockReturnValueOnce( mockWindow2 );
		vi.mocked( BrowserWindow.getAllWindows ).mockReturnValueOnce( [ mockWindow1, mockWindow2 ] );

		const window = await getMainWindow();
		expect( window ).toBe( mockWindow2 );
	} );

	it( 'returns the first window when the reference is destroyed and no window is focused', async () => {
		const mockWindow1 = new BrowserWindow();
		const mockWindow2 = new BrowserWindow();
		vi.mocked( createdWindow.isDestroyed ).mockReturnValueOnce( true );
		vi.mocked( BrowserWindow.getAllWindows ).mockReturnValueOnce( [ mockWindow1, mockWindow2 ] );

		const window = await getMainWindow();
		expect( window ).toBe( mockWindow1 );
	} );

	it( 'returns a new window when no non-destroyed windows exist', async () => {
		vi.mocked( createdWindow.isDestroyed ).mockReturnValueOnce( true );
		vi.mocked( BrowserWindow.getAllWindows ).mockReturnValueOnce( [] );

		const window = await getMainWindow();

		// Should return a BrowserWindow instance (creates a new one internally)
		expect( window ).toBeInstanceOf( BrowserWindow );
		expect( window.loadFile ).toHaveBeenCalled();
	} );
} );

describe( 'fullscreen events', () => {
	let createdWindow: BrowserWindow;

	beforeEach( async () => {
		mockEventHandlers.clear();
		createdWindow = await createMainWindow();
	} );

	afterEach( () => {
		__resetMainWindow();
	} );

	it( 'sends fullscreen-change event when entering fullscreen', () => {
		// Get the registered event handler for 'enter-full-screen'
		const handlers = mockEventHandlers.get( 'enter-full-screen' );
		expect( handlers ).toBeDefined();
		expect( handlers!.length ).toBeGreaterThan( 0 );

		// Simulate entering fullscreen by calling the handler
		handlers![ 0 ]();

		expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
			createdWindow,
			'window-fullscreen-change',
			true
		);
	} );

	it( 'sends fullscreen-change event when leaving fullscreen', () => {
		// Get the registered event handler for 'leave-full-screen'
		const handlers = mockEventHandlers.get( 'leave-full-screen' );
		expect( handlers ).toBeDefined();
		expect( handlers!.length ).toBeGreaterThan( 0 );

		// Simulate leaving fullscreen by calling the handler
		handlers![ 0 ]();

		expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
			createdWindow,
			'window-fullscreen-change',
			false
		);
	} );
} );
