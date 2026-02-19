import { vi } from 'vitest';

// Shared mock functions for Logger used across CLI tests
export const mockReportStart = vi.fn();
export const mockReportSuccess = vi.fn();
export const mockReportError = vi.fn();
export const mockReportProgress = vi.fn();
export const mockReportWarning = vi.fn();
export const mockReportKeyValuePair = vi.fn();

/**
 * Creates a mock Logger instance with all the standard methods
 * Use this in vi.mock('cli/logger') calls
 */
export const createMockLogger = () => ( {
	reportStart: mockReportStart,
	reportSuccess: mockReportSuccess,
	reportError: mockReportError,
	reportProgress: mockReportProgress,
	reportWarning: mockReportWarning,
	reportKeyValuePair: mockReportKeyValuePair,
	spinner: {},
	currentAction: null,
} );
