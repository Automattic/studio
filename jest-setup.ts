import '@testing-library/jest-dom';
import nock from 'nock';

// The ipcListener global is usually defined in preload.ts
window.ipcListener = { subscribe: jest.fn() };

nock.disableNetConnect();

// Jest runs in standard Node, not Electron. @sentry/electron doesn't seem to work.
jest.mock( '@sentry/electron/main', () => ( {
	captureException: jest.fn(),
} ) );
