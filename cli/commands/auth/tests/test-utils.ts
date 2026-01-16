import { vi } from 'vitest';

// Shared mock functions for Logger
export const mockReportStart = vi.fn();
export const mockReportSuccess = vi.fn();
export const mockReportError = vi.fn();
export const mockReportProgress = vi.fn();
export const mockReportWarning = vi.fn();
export const mockReportKeyValuePair = vi.fn();
