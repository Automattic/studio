import { StatsMetric } from 'src/lib/bump-stats';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import type { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';

export interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	isFullScreen?: boolean;
}

export interface AppdataSiteData {
	themeDetails?: SiteDetails[ 'themeDetails' ];
	sortOrder?: number;
}

// Increment `APP_CONFIG_VERSION` for breaking changes to app.json. When the
// current build boots and finds an app.json stamped with a *higher* version it
// refuses to load and prompts the user to upgrade, matching the pattern in
// `tools/common/lib/shared-config.ts`. Additive, non-breaking changes should
// leave this constant alone.
export const APP_CONFIG_VERSION = 2;

export type AppConfigVersion = typeof APP_CONFIG_VERSION;

export interface UserData {
	version: AppConfigVersion;
	siteMetadata: Record< string, AppdataSiteData >;
	devToolsOpen?: boolean;
	windowBounds?: WindowBounds;
	onboardingCompleted?: boolean;
	lastBumpStats?: Record< string, Partial< Record< StatsMetric, number > > >;
	promptWindowsSpeedUpResult?: PromptWindowsSpeedUpResult;
	sentryUserId?: string;
	lastSeenVersion?: string;
	preferredTerminal?: SupportedTerminal;
	preferredEditor?: SupportedEditor;
	colorScheme?: 'system' | 'light' | 'dark';
	betaFeatures?: BetaFeatures;
	stopSitesOnQuit?: boolean;
	cliAutoInstalled?: boolean;
}

export interface PromptWindowsSpeedUpResult {
	response: 'yes' | 'no';
	appVersion: string;
	dontAskAgain: boolean;
}

export const EMPTY_USER_DATA: UserData = {
	version: APP_CONFIG_VERSION,
	siteMetadata: {},
};
