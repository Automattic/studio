import '@testing-library/jest-dom';
// eslint-disable-next-line import/no-unresolved
import 'web-streams-polyfill/polyfill';
import nock from 'nock';

if ( typeof window !== 'undefined' ) {
	// The ipcListener global is usually defined in preload.ts
	window.ipcListener = { subscribe: jest.fn() };
}

nock.disableNetConnect();
nock.enableNetConnect( 'raw.githubusercontent.com' );

// We consider the app to be online by default.
jest.mock( './src/hooks/use-offline', () => ( {
	useOffline: jest.fn().mockReturnValue( false ),
} ) );

global.ResizeObserver = require( 'resize-observer-polyfill' );
