import '@testing-library/jest-dom';
// We need this polyfill because the `ReadableStream` class is
// used by `@php-wasm/universal` and it's not available in the Jest environment.
// eslint-disable-next-line import/no-unresolved
import 'web-streams-polyfill/polyfill';
import nock from 'nock';

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
}

nock.disableNetConnect();
nock.enableNetConnect( 'raw.githubusercontent.com' );

// We consider the app to be online by default.
jest.mock( './src/hooks/use-offline', () => ( {
	useOffline: jest.fn().mockReturnValue( false ),
} ) );

global.ResizeObserver = require( 'resize-observer-polyfill' );
