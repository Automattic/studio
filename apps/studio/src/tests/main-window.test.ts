/**
 * @vitest-environment node
 */
import { BrowserWindow } from 'electron';
import { readFile } from 'atomically';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import {
	createMainWindow,
	getMainWindow,
	isToggleSidebarShortcut,
	__resetMainWindow,
} from 'src/main-window';

vi.mock( 'fs' );
vi.mock( 'src/ipc-utils' );
vi.mock( 'atomically' );
vi.mock( 'src/lib/app-globals', () => ( {
	saveWindowBounds: vi.fn(),
} ) );

// Create a simpler mock that tracks event handlers
const mockEventHandlers = new Map< string, ( ( ...args: any[] ) => void )[] >();
const mockWebContentsEventHandlers = new Map< string, ( ( ...args: any[] ) => void )[] >();

vi.mock( 'electron', () => {
	class MockBrowserWindow {
		static fromWebContents = vi.fn().mockImplementation( () => new MockBrowserWindow() );
		static getFocusedWindow = vi.fn();
		static getAllWindows = vi.fn().mockReturnValue( [] );

		isDestroyed = vi.fn().mockReturnValue( false );
		isFullScreen = vi.fn().mockReturnValue( false );
		loadFile = vi.fn().mockResolvedValue( undefined );
		loadURL = vi.fn().mockResolvedValue( undefined );
		setBackgroundColor = vi.fn();
		setTitleBarOverlay = vi.fn();
		getBounds = vi.fn().mockReturnValue( { x: 0, y: 0, width: 800, height: 600 } );

		on = vi.fn().mockImplementation( ( event: string, handler: ( ...args: any[] ) => void ) => {
			if ( ! mockEventHandlers.has( event ) ) {
				mockEventHandlers.set( event, [] );
			}
			mockEventHandlers.get( event )!.push( handler );
		} );

		webContents = {
			isDestroyed: vi.fn().mockReturnValue( false ),
			send: vi.fn(),
			on: vi.fn().mockImplementation( ( event: string, handler: ( ...args: any[] ) => void ) => {
				if ( ! mockWebContentsEventHandlers.has( event ) ) {
					mockWebContentsEventHandlers.set( event, [] );
				}
				mockWebContentsEventHandlers.get( event )!.push( handler );

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
		nativeTheme: {
			themeSource: 'light',
			shouldUseDarkColors: false,
			on: vi.fn(),
			removeListener: vi.fn(),
		},
		screen: {
			getAllDisplays: vi.fn().mockReturnValue( [] ),
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
vi.mocked( readFile ).mockResolvedValue( Buffer.from( JSON.stringify( mockUserData ) ) );

beforeEach( () => {
	delete process.env.ENABLE_AGENTIC_UI;
	delete process.env.ELECTRON_UI_RENDERER_URL;
	delete process.env.ELECTRON_RENDERER_URL;
	mockWebContentsEventHandlers.clear();
} );

describe( 'getMainWindow', () => {
	let createdWindow: BrowserWindow;

	beforeEach( async () => {
		vol.reset();
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

describe( 'renderer selection', () => {
	afterEach( () => {
		__resetMainWindow();
	} );

	it( 'loads the legacy renderer by default', async () => {
		const createdWindow = await createMainWindow();
		const rendererPath = vi.mocked( createdWindow.loadFile ).mock.calls[ 0 ][ 0 ];

		expect( rendererPath.replace( /\\/g, '/' ) ).toContain( 'renderer/index.html' );
		expect( createdWindow.loadURL ).not.toHaveBeenCalled();
	} );

	it( 'loads the UI dev server when the agentic UI flag is enabled', async () => {
		process.env.ENABLE_AGENTIC_UI = 'true';
		process.env.ELECTRON_UI_RENDERER_URL = 'http://localhost:5200';

		const createdWindow = await createMainWindow();

		expect( createdWindow.loadURL ).toHaveBeenCalledWith( 'http://localhost:5200' );
		expect( createdWindow.loadFile ).not.toHaveBeenCalled();
	} );
} );

describe( 'sidebar shortcut', () => {
	afterEach( () => {
		__resetMainWindow();
	} );

	it( 'matches command+b on macOS and control+b on other platforms', () => {
		const input = {
			type: 'keyDown',
			key: 'b',
			code: 'KeyB',
			isAutoRepeat: false,
			isComposing: false,
			shift: false,
			control: false,
			alt: false,
			meta: false,
			location: 0,
			modifiers: [],
		} as Electron.Input;

		expect( isToggleSidebarShortcut( { ...input, meta: true }, 'darwin' ) ).toBe( true );
		expect( isToggleSidebarShortcut( { ...input, control: true }, 'win32' ) ).toBe( true );
		expect( isToggleSidebarShortcut( { ...input, control: true }, 'linux' ) ).toBe( true );
		expect( isToggleSidebarShortcut( { ...input, control: true }, 'darwin' ) ).toBe( false );
		expect( isToggleSidebarShortcut( { ...input, meta: true }, 'win32' ) ).toBe( false );
		expect( isToggleSidebarShortcut( { ...input, meta: true, shift: true }, 'darwin' ) ).toBe(
			false
		);
		expect(
			isToggleSidebarShortcut( { ...input, meta: true, isAutoRepeat: true }, 'darwin' )
		).toBe( false );
	} );

	it( 'sends a renderer toggle event from the main window shortcut handler', async () => {
		const createdWindow = await createMainWindow();
		const handlers = mockWebContentsEventHandlers.get( 'before-input-event' );
		const event = { preventDefault: vi.fn() };

		expect( handlers ).toBeDefined();
		handlers![ 0 ]( event, {
			type: 'keyDown',
			key: 'b',
			code: 'KeyB',
			isAutoRepeat: false,
			isComposing: false,
			shift: false,
			control: process.platform !== 'darwin',
			alt: false,
			meta: process.platform === 'darwin',
			location: 0,
			modifiers: [],
		} as Electron.Input );

		expect( event.preventDefault ).toHaveBeenCalled();
		expect( sendIpcEventToRendererWithWindow ).toHaveBeenCalledWith(
			createdWindow,
			'toggle-sidebar'
		);
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
