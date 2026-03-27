import { vi } from 'vitest';

export const connectToDaemon = vi.fn().mockResolvedValue( undefined );
export const disconnectFromDaemon = vi.fn().mockResolvedValue( undefined );
export const emitCliEvent = vi.fn().mockResolvedValue( undefined );
export const killDaemonAndChildren = vi.fn().mockResolvedValue( undefined );
export const listProcesses = vi.fn().mockResolvedValue( [] );
export const getDaemonBus = vi.fn().mockResolvedValue( {} );
export const sendMessageToProcess = vi.fn().mockResolvedValue( undefined );
export const startProcess = vi.fn().mockResolvedValue( {} );
export const stopProcess = vi.fn().mockResolvedValue( undefined );
export const deleteProcess = vi.fn().mockResolvedValue( undefined );
export const restartProcess = vi.fn().mockResolvedValue( {} );
export const getProcessByName = vi.fn().mockResolvedValue( undefined );
export const subscribeSiteEvents = vi.fn().mockResolvedValue( undefined );
export const subscribeDaemonKillEvent = vi.fn().mockResolvedValue( undefined );
export const isProcessRunning = vi.fn().mockResolvedValue( false );

export const SITE_EVENTS_SOCKET_PATH = '/test/events.sock';
