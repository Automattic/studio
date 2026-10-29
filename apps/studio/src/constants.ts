export const DEFAULT_WIDTH = 1100;
export const DEFAULT_HEIGHT = 820;
export const MAIN_MIN_HEIGHT = 600;
// Wide enough for the chat and the preview side by side; below the sidebar's
// share of the width, the sidebar opens over them instead.
export const AGENTIC_MIN_WIDTH = 800;
export const SCREENSHOT_WIDTH = 1040;
export const SCREENSHOT_HEIGHT = 1248;
export const AUTO_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
export const NIGHTLY_UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
export const MACOS_TRAFFIC_LIGHT_POSITION = { x: 20, y: 17 };
export const WINDOWS_TITLEBAR_HEIGHT = 44;
// Match the renderer's --band-height so native caption buttons align with the toolbar.
export const AGENTIC_TITLEBAR_HEIGHT = 48;
export const ABOUT_WINDOW_WIDTH = 300;
export const ABOUT_WINDOW_HEIGHT = 285;
export const BUG_REPORT_URL =
	'https://github.com/Automattic/studio/issues/new?assignees=&labels=Needs+triage%2C%5BType%5D+Bug&projects=&template=bug_report.yml';
export const FEATURE_REQUEST_URL =
	'https://github.com/Automattic/studio/issues/new?assignees=&labels=%5BType%5D+Feature+Request&projects=&template=feature_request.yml&title=Feature+Request%3A';
export { DEFAULT_TERMINAL } from '@studio/common/lib/user-settings/terminal';

// WP-CLI
export const WP_CLI_DEFAULT_RESPONSE_TIMEOUT = 5 * 60 * 1000; // 5min
export const WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT = 6 * 60 * 60 * 1000; // 6hr

// IPC handlers that don't return anything (i.e. that are called with `ipcRenderer.send`)
export const IPC_VOID_HANDLERS = [
	'cancelSyncOperation',
	'openLocalPath',
	'openSiteURL',
	'openStudioLogs',
	'openURL',
	'popupAppMenu',
	'readyForDeeplinks',
	'showErrorMessageBox',
	'authenticate',
] as const;
