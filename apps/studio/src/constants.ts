export const DEFAULT_WIDTH = 1100;
export const DEFAULT_HEIGHT = 820;
export const MAIN_MIN_HEIGHT = 600;
export const SIDEBAR_WIDTH = 208;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
export const MAIN_MIN_WIDTH = 712;
export const LOCAL_STORAGE_SIDEBAR_WIDTH_KEY = 'sidebar_width';
export const APP_CHROME_SPACING = 10;
export const MIN_WIDTH_CLASS_TO_MEASURE = 'app-measure-tabs-width';
export const MIN_WIDTH_SELECTOR_TO_MEASURE = `.${ MIN_WIDTH_CLASS_TO_MEASURE }`;
export const SCREENSHOT_WIDTH = 1040;
export const SCREENSHOT_HEIGHT = 1248;
export const LIMIT_OF_ZIP_SITES_PER_USER = 10;
export const UPDATED_MESSAGE_DURATION_MS = 60000; // 1 minute
export const AUTO_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const NIGHTLY_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
export const MACOS_TRAFFIC_LIGHT_POSITION = { x: 20, y: 20 };
export const WINDOWS_TITLEBAR_HEIGHT = 44;
export const EMPTY_SITE_PLAYGROUND_URL = 'https://playground.wordpress.net/';
export const ABOUT_WINDOW_WIDTH = 300;
export const ABOUT_WINDOW_HEIGHT = 350;
export const BUG_REPORT_URL =
	'https://github.com/Automattic/studio/issues/new?assignees=&labels=Needs+triage%2C%5BType%5D+Bug&projects=&template=bug_report.yml';
export const FEATURE_REQUEST_URL =
	'https://github.com/Automattic/studio/issues/new?assignees=&labels=%5BType%5D+Feature+Request&projects=&template=feature_request.yml&title=Feature+Request%3A';
export const WPCOM_PROFILE_URL = 'https://wordpress.com/me';
export const DEFAULT_TERMINAL = 'terminal';

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

// WP-CLI
export const WP_CLI_DEFAULT_RESPONSE_TIMEOUT = 5 * 60 * 1000; // 5min
export const WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS = 6;
export const WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT =
	WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS * 60 * 60 * 1000; // 6hr

// SQLite
const SQLITE_DATABASE_INTEGRATION_VERSION = 'v3.0.0-rc.6';

export const SQLITE_DATABASE_INTEGRATION_RELEASE_URL = `https://github.com/WordPress/sqlite-database-integration/releases/download/${ SQLITE_DATABASE_INTEGRATION_VERSION }/plugin-sqlite-database-integration.zip`;

// IPC handlers that don't return anything (i.e. that are called with `ipcRenderer.send`)
export const IPC_VOID_HANDLERS = [
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
	'showChatNotification',
	'authenticate',
] as const;

// What's New
// Flip to `true` when shipping new modal content so users who haven't seen the
// current app version get the modal once. Keep at `false` otherwise — the modal
// will only auto-show for first-time users of Studio.
export const FORCE_SHOW_WHATS_NEW = true;
