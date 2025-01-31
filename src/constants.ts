export const DEFAULT_WIDTH = 900;
export const MAIN_MIN_HEIGHT = 600;
export const SIDEBAR_WIDTH = 268;
export const MAIN_MIN_WIDTH = DEFAULT_WIDTH - SIDEBAR_WIDTH + 20;
export const SCREENSHOT_WIDTH = 1040;
export const SCREENSHOT_HEIGHT = 1248;
export const LIMIT_OF_ZIP_SITES_PER_USER = 10;
export const LIMIT_OF_PROMPTS_PER_USER = 200;
export const UPDATED_MESSAGE_DURATION_MS = 60000; // 1 minute
export const DEMO_SITE_SIZE_LIMIT_GB = 2;
export const DEMO_SITE_SIZE_LIMIT_BYTES = DEMO_SITE_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 2GB
export const SYNC_PUSH_SIZE_LIMIT_GB = 2;
export const SYNC_PUSH_SIZE_LIMIT_BYTES = SYNC_PUSH_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 2GB
export const AUTO_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const WINDOWS_TITLEBAR_HEIGHT = 32;
export const ABOUT_WINDOW_WIDTH = 284;
export const ABOUT_WINDOW_HEIGHT = 350;
export const AI_GUIDELINES_URL = 'https://automattic.com/ai-guidelines/';
export const STUDIO_DOCS_URL = `https://developer.wordpress.com/docs/developer-tools/studio/`;
export const STUDIO_DOCS_URL_IMPORT_EXPORT =
	'https://developer.wordpress.com/docs/developer-tools/studio/import-export';
export const STUDIO_DOCS_URL_SITES =
	'https://developer.wordpress.com/docs/developer-tools/studio/sites/';
export const BUG_REPORT_URL =
	'https://github.com/Automattic/studio/issues/new?assignees=&labels=Needs+triage%2C%5BType%5D+Bug&projects=&template=bug_report.yml';
export const FEATURE_REQUEST_URL =
	'https://github.com/Automattic/studio/issues/new?assignees=&labels=%5BType%5D+Feature+Request&projects=&template=feature_request.yml&title=Feature+Request%3A';
export const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
export const STUDIO_DOCS_URL_GET_HELP_UNSUPPORTED_SITES =
	'https://developer.wordpress.com/docs/developer-tools/studio/';
export const LOCAL_STORAGE_CHAT_MESSAGES_KEY = 'ai_chat_messages';
export const LOCAL_STORAGE_CHAT_API_IDS_KEY = 'ai_chat_ids';

//Import file constants

export const ACCEPTED_IMPORT_FILE_TYPES = [ '.zip', '.gz', '.gzip', '.tar', '.tar.gz', '.wpress' ];

// OAuth constants
export const CLIENT_ID = '95109';
export const PROTOCOL_PREFIX = 'wpcom-local-dev';
export const WP_AUTHORIZE_ENDPOINT = 'https://public-api.wordpress.com/oauth2/authorize';
export const SCOPES = 'global';

// Time-related constants
export const HOUR_MS = 1000 * 60 * 60;
export const DAY_MS = HOUR_MS * 24;

// AI Assistant constants
// IMPORTANT: When updating this value, we need to update the string located in `AIClearHistoryReminder` component.
// Reference: https://github.com/Automattic/studio/blob/3dd5c58cdb7998e458d191e508e8e859177225a9/src/components/ai-clear-history-reminder.tsx#L78
export const CLEAR_HISTORY_REMINDER_TIME = 2 * HOUR_MS; // In milliseconds
