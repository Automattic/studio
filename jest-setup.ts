import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'util';
import 'isomorphic-fetch';
import nock from 'nock';

// Configure testing-library with longer timeouts for CI environments
configure( {
	// Default timeout for waitFor, findBy*, etc. (5 seconds instead of 1 second)
	asyncUtilTimeout: 5000,
} );

// Polyfill TextEncoder and TextDecoder for tests
if ( typeof globalThis.TextEncoder === 'undefined' ) {
	globalThis.TextEncoder = TextEncoder as any;
}
if ( typeof globalThis.TextDecoder === 'undefined' ) {
	globalThis.TextDecoder = TextDecoder as any;
}

// We need this polyfill because the `ReadableStream` class is
// used by `@php-wasm/universal` and it's not available in the Jest environment.
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

// Store original console.log to restore after tests
const originalConsoleLog = console.log;

// Silence console.log for all tests
beforeEach( () => {
	console.log = jest.fn();
} );

// Clean up after each test to prevent state leakage
afterEach( () => {
	// Restore console.log
	console.log = originalConsoleLog;

	// Clean up all nock interceptors to prevent test interference
	nock.cleanAll();

	// Reset timers if fake timers were used (prevents timer leaks)
	try {
		jest.useRealTimers();
	} catch {
		// Ignore if real timers are already in use
	}

	// Clear all mocks to prevent state leakage
	jest.clearAllMocks();
} );

if ( typeof window !== 'undefined' ) {
	// The ipcListener global is usually defined in preload.ts
	window.ipcListener = { subscribe: jest.fn() };

	// Mock `matchMedia` as it's not implemented in JSDOM
	// Reference: https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom
	Object.defineProperty( window, 'matchMedia', {
		writable: true,
		value: jest.fn().mockImplementation( ( query ) => ( {
			matches: false,
			media: query,
			onchange: null,
			addListener: jest.fn(), // deprecated
			removeListener: jest.fn(), // deprecated
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
			dispatchEvent: jest.fn(),
		} ) ),
	} );

	/**
	 * Mock `crypto.subtle.generateKey` as it's not implemented in JSDOM
	 * https://github.com/jsdom/jsdom/issues/1612
	 *
	 * `crypto.subtle.generateKey` is required by `@php-wasm/web`
	 */
	Object.defineProperty( global.crypto, 'subtle', {
		value: { generateKey: jest.fn() },
	} );
}

nock.disableNetConnect();
nock.enableNetConnect( 'raw.githubusercontent.com' );

// We consider the app to be online by default.
jest.mock( './src/hooks/use-offline', () => ( {
	useOffline: jest.fn().mockReturnValue( false ),
} ) );

jest.mock( './src/hooks/use-ai-icon', () => ( {
	__esModule: true,
	default: () => ( {
		rive: null,
		RiveComponent: () => null,
		setInputState: jest.fn(),
	} ),
} ) );

global.ResizeObserver = require( 'resize-observer-polyfill' );
