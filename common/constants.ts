export const DEMO_SITE_SIZE_LIMIT_GB = 2;
export const DEMO_SITE_SIZE_LIMIT_BYTES = DEMO_SITE_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 2GB
export const HOUR_MS = 1000 * 60 * 60;
export const DAY_MS = HOUR_MS * 24;
// AI Assistant constants
// IMPORTANT: When updating this value, we need to update the string located in `AIClearHistoryReminder` component.
// Reference: https://github.com/Automattic/studio/blob/3dd5c58cdb7998e458d191e508e8e859177225a9/src/components/ai-clear-history-reminder.tsx#L78
export const CLEAR_HISTORY_REMINDER_TIME = 2 * HOUR_MS; // In milliseconds
