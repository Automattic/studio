import '@testing-library/jest-dom';

// The ipcListener global is usually defined in preload.ts
( window as any ).ipcListener = { subscribe: jest.fn() }; // eslint-disable-line @typescript-eslint/no-explicit-any
