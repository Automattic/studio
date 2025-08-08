import '@testing-library/jest-dom';
import nock from 'nock';
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

// Silence console.log for all tests
beforeEach( () => {
	console.log = jest.fn();
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

	/**
	 * Mock `fetch` as it's not implemented in JSDOM
	 * https://github.com/jsdom/jsdom/issues/1724
	 *
	 * `fetch` is required by `@wp-playground/blueprints`
	 */
	global.fetch = jest.fn();
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
		rive: jest.fn(),
		RiveComponent: jest.fn(),
		inactiveInput: jest.fn(),
		typingInput: jest.fn(),
		thinkingInput: jest.fn(),
		startStateMachine: jest.fn(),
		pauseStateMachine: jest.fn(),
	} ),
} ) );

global.ResizeObserver = require( 'resize-observer-polyfill' );
