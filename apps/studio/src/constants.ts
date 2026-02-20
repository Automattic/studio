import { HOUR_MS } from '@studio/common/constants';
export const DEFAULT_WIDTH = 900;
export const MAIN_MIN_HEIGHT = 600;
export const SIDEBAR_WIDTH = 208;
export const MAIN_MIN_WIDTH = DEFAULT_WIDTH - SIDEBAR_WIDTH + 20;
export const APP_CHROME_SPACING = 10;
export const MIN_WIDTH_CLASS_TO_MEASURE = 'app-measure-tabs-width';
export const MIN_WIDTH_SELECTOR_TO_MEASURE = `.${ MIN_WIDTH_CLASS_TO_MEASURE }`;
export const SCREENSHOT_WIDTH = 1040;
export const SCREENSHOT_HEIGHT = 1248;
export const LIMIT_OF_ZIP_SITES_PER_USER = 10;
export const LIMIT_OF_PROMPTS_PER_USER = 200;
export const UPDATED_MESSAGE_DURATION_MS = 60000; // 1 minute
export const SYNC_PUSH_SIZE_LIMIT_GB = 5;
export const SYNC_PUSH_SIZE_LIMIT_BYTES = SYNC_PUSH_SIZE_LIMIT_GB * 1024 * 1024 * 1024; // 5GB
export const AUTO_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const WINDOWS_TITLEBAR_HEIGHT = 32;
export const ABOUT_WINDOW_WIDTH = 300;
export const ABOUT_WINDOW_HEIGHT = 350;
export const TELEX_HOSTNAME = 'telex.automattic.ai';
export const TELEX_UTM_PARAMS = {
	utm_source: 'studio',
	utm_medium: 'app',
	utm_campaign: 'assistant',
} as const;
export const BUG_REPORT_URL =
	'https://github.com/Automattic/studio/issues/new?assignees=&labels=Needs+triage%2C%5BType%5D+Bug&projects=&template=bug_report.yml';
export const FEATURE_REQUEST_URL =
	'https://github.com/Automattic/studio/issues/new?assignees=&labels=%5BType%5D+Feature+Request&projects=&template=feature_request.yml&title=Feature+Request%3A';
export const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
export const LOCAL_STORAGE_CHAT_MESSAGES_KEY = 'ai_chat_messages';
export const LOCAL_STORAGE_CHAT_API_IDS_KEY = 'ai_chat_ids';
export const DEFAULT_TERMINAL = 'terminal';

//Import file constants

export const ACCEPTED_IMPORT_FILE_TYPES = [ '.zip', '.gz', '.gzip', '.tar', '.tar.gz', '.wpress' ];

// Archiver options
export const ARCHIVER_OPTIONS = {
	zip: {
		zlib: { level: 9 },
		followSymlinks: true,
	},
	tar: {
		gzip: true,
		gzipOptions: { level: 9 },
		followSymlinks: true,
	},
};

export const SYNC_OPTIONS = {
	// Options sent for pull and push
	all: 'all',
	sqls: 'sqls',
	// Option sent for pull
	paths: 'paths',
	// Options sent for push
	themes: 'themes',
	plugins: 'plugins',
	uploads: 'uploads',
	contents: 'contents',
} as const;

// AI Assistant constants
// IMPORTANT: When updating this value, we need to update the string located in `AIClearHistoryReminder` component.
// Reference: https://github.com/Automattic/studio/blob/3dd5c58cdb7998e458d191e508e8e859177225a9/src/components/ai-clear-history-reminder.tsx#L78
export const CLEAR_HISTORY_REMINDER_TIME = 2 * HOUR_MS; // In milliseconds

// WP-CLI
export const WP_CLI_DEFAULT_RESPONSE_TIMEOUT = 5 * 60 * 1000; // 5min
export const WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS = 6;
export const WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT =
	WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS * 60 * 60 * 1000; // 6hr

// SQLite
export const SQLITE_DATABASE_INTEGRATION_VERSION = 'v2.2.17';

export const SQLITE_DATABASE_INTEGRATION_RELEASE_URL = `https://github.com/WordPress/sqlite-database-integration/archive/refs/tags/${ SQLITE_DATABASE_INTEGRATION_VERSION }.zip`;

// IPC handlers that don't return anything (i.e. that are called with `ipcRenderer.send`)
export const IPC_VOID_HANDLERS = < const >[
	'addSyncOperation',
	'clearSyncOperation',
	'cancelSyncOperation',
	'logRendererMessage',
	'openCertificate',
	'openFileInIDE',
	'openLocalPath',
	'openSiteURL',
	'openURL',
	'popupAppMenu',
	'setWindowButtonVisibility',
	'showErrorMessageBox',
	'showSiteContextMenu',
	'showItemInFolder',
	'showNotification',
	'authenticate',
];

// What's New
export const FORCE_WHATS_NEW_WHEN_PATCH_CHANGED = false;
