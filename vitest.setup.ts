import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import 'isomorphic-fetch';
import nock from 'nock';
import { vi, beforeEach, afterEach, afterAll } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - no types available for ponyfill
import * as streams from 'web-streams-polyfill/dist/ponyfill.js';

// Configure testing-library with longer timeouts for CI environments
configure( {
	// Default timeout for waitFor, findBy*, etc. (5 seconds instead of 1 second)
	asyncUtilTimeout: 5000,
} );

// Polyfill TextEncoder and TextDecoder for tests
if ( typeof globalThis.TextEncoder === 'undefined' ) {
	globalThis.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;
}
if ( typeof globalThis.TextDecoder === 'undefined' ) {
	globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
}

// Polyfill crypto for Node.js environment tests
if ( typeof globalThis.crypto === 'undefined' ) {
	globalThis.crypto = webcrypto as Crypto;
}

// We need this polyfill because the `ReadableStream` class is
// used by `@php-wasm/universal` and it's not available in the Vitest environment.
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
				removeProperty: () => '',
				item: () => '',
				length: 0,
				[ Symbol.iterator ]: function* () {},
			} as unknown as CSSStyleDeclaration;
		}
	};
}

// Define global variables that were previously in vitest.config.mts
( global as typeof global & { COMMIT_HASH: string } ).COMMIT_HASH = 'mock-hash';

// Store original console.log to restore after tests
const originalConsoleLog = console.log;

// Silence console.log for all tests
beforeEach( () => {
	console.log = vi.fn();
} );

if ( typeof window !== 'undefined' ) {
	// The ipcListener global is usually defined in preload.ts
	window.ipcListener = { subscribe: vi.fn() };

	// Mock `matchMedia` as it's not implemented in JSDOM
	// Reference: https://vitest.dev/guide/mocking#modules
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

// Clean up after each test to prevent state leakage
afterEach( () => {
	// Restore console.log
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

vi.mock( 'ora', () => {
	const mockOra = () => ( {
		start: vi.fn().mockReturnThis(),
		stop: vi.fn().mockReturnThis(),
		succeed: vi.fn().mockReturnThis(),
		fail: vi.fn().mockReturnThis(),
		warn: vi.fn().mockReturnThis(),
		info: vi.fn().mockReturnThis(),
		text: '',
		isSpinning: false,
	} );
	return {
		default: mockOra,
	};
} );
