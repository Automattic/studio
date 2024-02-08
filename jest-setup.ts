import '@testing-library/jest-dom';

// The ipcListener global is usually defined in preload.ts
window.ipcListener = { subscribe: jest.fn() };
