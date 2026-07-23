import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import 'isomorphic-fetch';
import nock from 'nock';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - no types available for ponyfill
import * as streams from 'web-streams-polyfill/dist/ponyfill.js';

configure( {
	asyncUtilTimeout: 5000,
} );

if ( typeof globalThis.TextEncoder === 'undefined' ) {
	globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
}
if ( typeof globalThis.TextDecoder === 'undefined' ) {
	globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

if ( typeof globalThis.crypto === 'undefined' ) {
	globalThis.crypto = webcrypto as Crypto;
}

if ( typeof globalThis.ReadableStream === 'undefined' ) {
	globalThis.ReadableStream = streams.ReadableStream;
	globalThis.WritableStream = streams.WritableStream;
	globalThis.TransformStream = streams.TransformStream;
}

if ( typeof window !== 'undefined' ) {
	const originalGetComputedStyle = window.getComputedStyle;
	window.getComputedStyle = function ( element: Element, pseudoElement?: string | null ) {
		try {
			return originalGetComputedStyle.call( this, element, pseudoElement );
		} catch ( error ) {
			return {
				getPropertyValue: () => '',
				setProperty: () => {},
				removeProperty: () => '',
				item: () => '',
				length: 0,
				[ Symbol.iterator ]: function* () {},
			} as unknown as CSSStyleDeclaration;
		}
	};

	// Suppress jsdom CSS parse errors. jsdom's rrweb-cssom parser can't handle modern CSS
	// features (@layer, nesting) used by @wordpress/ui, causing ~54 noisy errors per run.
	// The virtualConsole emits "jsdomError" events that forward to console.error via sendTo().
	// We remove those listeners to prevent the noise since the errors are harmless.
	const jsdomInstance = (
		window as unknown as { jsdom?: { virtualConsole?: NodeJS.EventEmitter } }
	 ).jsdom;
	if ( jsdomInstance?.virtualConsole ) {
		jsdomInstance.virtualConsole.removeAllListeners( 'jsdomError' );
	}
}

( global as typeof global & { COMMIT_HASH: string } ).COMMIT_HASH = 'mock-hash';

const originalConsoleLog = console.log;

beforeEach( () => {
	console.log = vi.fn();
} );

if ( typeof window !== 'undefined' ) {
	window.ipcListener = { subscribe: vi.fn() };

	Object.defineProperty( window, 'matchMedia', {
		writable: true,
		value: vi.fn().mockImplementation( ( query ) => ( {
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(),
			removeListener: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		} ) ),
	} );

	Object.defineProperty( global.crypto, 'subtle', {
		value: { generateKey: vi.fn() },
	} );
}

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

// We consider the app to be online by default.
vi.mock( 'src/hooks/use-offline', () => ( {
	useOffline: vi.fn().mockReturnValue( false ),
} ) );

global.ResizeObserver = require( 'resize-observer-polyfill' );

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
		},
		dialog: {
			showMessageBox: vi.fn(),
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
	};
} );

vi.mock( import( './src/storage/paths' ), () => ( {
	getResourcesPath: vi.fn().mockReturnValue( '/mock/resources' ),
	getUserDataFilePath: vi.fn().mockReturnValue( '/mock/userdata.json' ),
	getUserDataLockFilePath: vi.fn().mockReturnValue( '/mock/userdata.json.lock' ),
	getOldAppdataFilePath: vi.fn().mockReturnValue( '/mock/appdata-v1.json' ),
	getOldUserDataCertificatesPath: vi.fn().mockReturnValue( '/mock/certificates' ),
	getOldServerFilesPath: vi.fn().mockReturnValue( '/mock/server/files' ),
	getCliPath: vi.fn().mockReturnValue( '/mock/cli/path' ),
	getBundledNodeBinaryPath: vi.fn().mockReturnValue( '/mock/node/binary' ),
	getSiteThumbnailPath: vi.fn().mockReturnValue( '/mock/thumbnail.png' ),
	DEFAULT_SITE_PATH: '/mock/default/site/path',
} ) );

vi.mock( 'lockfile', () => {
	const lock = vi.fn( ( file, options, callback ) => callback( null ) );
	const unlock = vi.fn( ( file, callback ) => callback( null ) );
	return {
		default: {
			lock,
			unlock,
		},
		lock,
		unlock,
	};
} );

vi.mock( 'atomically', () => ( {
	readFile: vi.fn(),
	writeFile: vi.fn(),
} ) );

vi.mock( 'picospinner', () => {
	class MockSpinner {
		start = vi.fn().mockReturnThis();
		stop = vi.fn().mockReturnThis();
		succeed = vi.fn().mockReturnThis();
		fail = vi.fn().mockReturnThis();
		warn = vi.fn().mockReturnThis();
		info = vi.fn().mockReturnThis();
		setText = vi.fn().mockReturnThis();
		refresh = vi.fn().mockReturnThis();
		running = false;
	}
	return {
		Spinner: MockSpinner,
	};
} );
