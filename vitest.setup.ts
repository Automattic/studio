import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';
import 'isomorphic-fetch';
import nock from 'nock';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';

// Polyfill TextEncoder and TextDecoder for tests
if ( typeof globalThis.TextEncoder === 'undefined' ) {
	globalThis.TextEncoder = TextEncoder as any;
}
if ( typeof globalThis.TextDecoder === 'undefined' ) {
	globalThis.TextDecoder = TextDecoder as any;
}

// We need this polyfill because the `ReadableStream` class is
// used by `@php-wasm/universal` and it's not available in the Vitest environment.
// Import ponyfill to avoid global pollution issues with php-wasm 1.2.3
const streams = require( 'web-streams-polyfill/dist/ponyfill.js' );

// Assign to global only if not already available
if ( typeof globalThis.ReadableStream === 'undefined' ) {
	globalThis.ReadableStream = streams.ReadableStream;
	globalThis.WritableStream = streams.WritableStream;
	globalThis.TransformStream = streams.TransformStream;
}

// Mock CSS parsing to handle modern CSS selectors that JSDOM doesn't support
if ( typeof window !== 'undefined' ) {
	// Mock the CSS parser to ignore problematic selectors
	const originalGetComputedStyle = window.getComputedStyle;
	window.getComputedStyle = function ( element: Element, pseudoElement?: string | null ) {
		try {
			return originalGetComputedStyle.call( this, element, pseudoElement );
		} catch ( error ) {
			// Return a minimal computed style object to prevent crashes
			return {
				getPropertyValue: () => '',
				setProperty: () => {},
				removeProperty: () => {},
				item: () => '',
				length: 0,
				[ Symbol.iterator ]: function* () {},
			} as any;
		}
	};
}

// Define global variables that were previously in jest.config.ts
( global as any ).COMMIT_HASH = 'mock-hash';

// Silence console.log for all tests
beforeEach( () => {
	console.log = vi.fn();
} );

if ( typeof window !== 'undefined' ) {
	// The ipcListener global is usually defined in preload.ts
	window.ipcListener = { subscribe: vi.fn() };

	// Mock `matchMedia` as it's not implemented in JSDOM
	// Reference: https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom
	Object.defineProperty( window, 'matchMedia', {
		writable: true,
		value: vi.fn().mockImplementation( ( query ) => ( {
			matches: false,
			media: query,
			onchange: null,
			addListener: vi.fn(), // deprecated
			removeListener: vi.fn(), // deprecated
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		} ) ),
	} );

	/**
	 * Mock `crypto.subtle.generateKey` as it's not implemented in JSDOM
	 * https://github.com/jsdom/jsdom/issues/1612
	 *
	 * `crypto.subtle.generateKey` is required by `@php-wasm/web`
	 */
	Object.defineProperty( global.crypto, 'subtle', {
		value: { generateKey: vi.fn() },
	} );
}

nock.disableNetConnect();
nock.enableNetConnect( 'raw.githubusercontent.com' );

afterEach( () => {
	nock.cleanAll();
} );

afterAll( () => {
	nock.enableNetConnect();
	nock.restore();
} );

// We consider the app to be online by default.
vi.mock( './src/hooks/use-offline', () => ( {
	useOffline: vi.fn().mockReturnValue( false ),
} ) );

vi.mock( './src/hooks/use-ai-icon', () => ( {
	__esModule: true,
	default: () => ( {
		rive: null,
		RiveComponent: () => null,
		setInputState: vi.fn(),
	} ),
} ) );

global.ResizeObserver = require( 'resize-observer-polyfill' );

// Common mocks for Node environment tests
// These are needed when tests import from modules that depend on Electron or other native modules

vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
	captureMessage: vi.fn(),
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

vi.mock( 'src/storage/paths', () => ( {
	getResourcesPath: vi.fn().mockReturnValue( '/mock/resources' ),
	getUserDataFilePath: vi.fn().mockReturnValue( '/mock/userdata.json' ),
	getUserDataLockFilePath: vi.fn().mockReturnValue( '/mock/userdata.json.lock' ),
	getUserDataCertificatesPath: vi.fn().mockReturnValue( '/mock/certificates' ),
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
