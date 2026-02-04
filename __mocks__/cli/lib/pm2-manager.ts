import { vi } from 'vitest';

export const connect = vi.fn().mockResolvedValue( undefined );
export const disconnect = vi.fn().mockResolvedValue( undefined );
export const emitSiteEvent = vi.fn().mockResolvedValue( undefined );
export const killDaemonAndChildrenAndExitProcess = vi.fn().mockResolvedValue( undefined );
export const listProcesses = vi.fn().mockResolvedValue( [] );
export const getPm2Bus = vi.fn().mockResolvedValue( {} );
export const sendMessageToProcess = vi.fn().mockResolvedValue( undefined );
export const startProcess = vi.fn().mockResolvedValue( {} );
export const stopProcess = vi.fn().mockResolvedValue( undefined );
export const deleteProcess = vi.fn().mockResolvedValue( undefined );
export const restartProcess = vi.fn().mockResolvedValue( {} );
export const getProcessByName = vi.fn().mockResolvedValue( undefined );
export const subscribeSiteEvents = vi.fn().mockResolvedValue( undefined );
export const subscribePm2KillEvent = vi.fn().mockResolvedValue( undefined );
export const isProcessRunning = vi.fn().mockResolvedValue( false );

export const EVENTS_SOCKET_PATH = '/test/events.sock';
