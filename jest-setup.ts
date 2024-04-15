import '@testing-library/jest-dom';
import nock from 'nock';

if ( typeof window !== 'undefined' ) {
	// The ipcListener global is usually defined in preload.ts
	window.ipcListener = { subscribe: jest.fn() };
}

nock.disableNetConnect();

// Jest runs in standard Node, not Electron. @sentry/electron doesn't work in Node.
jest.mock( '@sentry/electron/main', () => ( {
	captureException: jest.fn(),
} ) );

// We consider the app to be online by default.
jest.mock( './src/hooks/use-offline', () => ( {
	useOffline: jest.fn().mockReturnValue( false ),
} ) );
