import nock from 'nock';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';

( global as typeof global & { COMMIT_HASH: string } ).COMMIT_HASH = 'mock-hash';

const originalConsoleLog = console.log;

beforeEach( () => {
	console.log = vi.fn();
} );

nock.disableNetConnect();
nock.enableNetConnect( 'raw.githubusercontent.com' );

afterEach( () => {
	console.log = originalConsoleLog;
	nock.cleanAll();

	try {
		vi.useRealTimers();
	} catch {
		// Ignore if real timers are already in use
	}
	vi.clearAllMocks();
} );

afterAll( () => {
	nock.enableNetConnect();
	nock.restore();
} );

vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
	captureMessage: vi.fn(),
	setTag: vi.fn(),
} ) );

vi.mock( 'electron', () => {
	class MockBrowserWindow {
		static fromWebContents = vi.fn( () => new MockBrowserWindow() );

		isDestroyed() {
			return false;
		}
		webContents = {
			isDestroyed: () => false,
			send: vi.fn(),
		};
	}

	return {
		__esModule: true,
		app: {
			getVersion: vi.fn(),
			getPath: vi.fn().mockReturnValue( '/mock/path' ),
			isPackaged: true,
		},
		dialog: {
			showMessageBox: vi.fn(),
		},
		autoUpdater: {
			setFeedURL: vi.fn(),
			getFeedURL: vi.fn(),
			checkForUpdates: vi.fn(),
			quitAndInstall: vi.fn(),
			on: vi.fn(),
		},
		BrowserWindow: MockBrowserWindow,
		shell: {
			openPath: vi.fn( async () => '' ),
			trashItem: vi.fn(),
		},
		Menu: vi.fn(),
		MenuItem: vi.fn(),
		clipboard: {
			writeText: vi.fn(),
		},
		Notification: vi.fn(),
		systemPreferences: {
			setUserDefault: vi.fn(),
		},
	};
} );

vi.mock( import( './src/storage/paths' ), () => ( {
	getResourcesPath: vi.fn().mockReturnValue( '/mock/resources' ),
	getCliPath: vi.fn().mockReturnValue( '/mock/cli/path' ),
	getBundledNodeBinaryPath: vi.fn().mockReturnValue( '/mock/node/binary' ),
	getWpCliPharPath: vi.fn().mockReturnValue( '/mock/cli/wp-files/wp-cli/wp-cli.phar' ),
	getSiteThumbnailPath: vi.fn().mockReturnValue( '/mock/thumbnail.png' ),
} ) );

vi.mock( 'proper-lockfile', () => ( {
	lock: vi.fn( async () => async () => {} ),
	unlock: vi.fn( async () => {} ),
} ) );

vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );
