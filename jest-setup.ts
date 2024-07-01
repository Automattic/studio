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

/**
 * TODO: Replace this manual filter with a more robust logger that can be
 * disabled for the testing environment. Consider enabling a lint rule that
 * discourages direct use of `console` methods.
 */
function filteredConsole( level: ( ...args: any[] ) => void ) {
	const ignoredMessages = [
		'Loaded user data from ',
		'Saved user data to ',
		'Server start',
		'Would have bumped stat: ',
		'Starting new session',
		'App version: ',
		'Built from commit: mock-hash',
		'Local timezone: UTC',
		'App locale: ',
		'System locale: ',
		'Used language: ',
	];

	return ( ...args: any[] ) => {
		if (
			ignoredMessages.some(
				( ignoredMessage ) => typeof args[ 0 ] === 'string' && args[ 0 ].includes( ignoredMessage )
			)
		) {
			return;
		}

		level( ...args );
	};
}
console.log = filteredConsole( console.log );
console.error = filteredConsole( console.error );
console.warn = filteredConsole( console.warn );
console.info = filteredConsole( console.info );

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
