import { StatsMetric } from 'src/lib/bump-stats';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import type { DesksConfig } from '@studio/common/types/desk';
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
	siteIconPath?: SiteDetails[ 'siteIconPath' ];
	sortOrder?: number;
	// Unix ms of the last time this site's runtime was counted in usage stats.
	// Dedupes the weekly per-site runtime bump so restarts don't inflate it.
	runtimeStatBumpedAt?: number;
}

export interface AiSessionSitePlacement {
	kind: 'site';
	siteId: string;
	sitePath: string;
	siteName: string;
}

export interface NightlyPromptResult {
	response: 'yes' | 'no';
	dontAskAgain: boolean;
}

export interface UserData {
	version: 1;
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
	defaultSiteDirectory?: string;
	cliAutoInstalled?: boolean;
	cliUserUninstalled?: boolean;
	wapuuScore?: number;
	desks?: DesksConfig;
	aiSessionPlacements?: Record< string, AiSessionSitePlacement >;
	lastNightlyUpdateCheck?: number;
	nightlyPromptResult?: NightlyPromptResult;
}

export interface PromptWindowsSpeedUpResult {
	response: 'yes' | 'no';
	appVersion: string;
	dontAskAgain: boolean;
}

export const EMPTY_USER_DATA: UserData = {
	version: 1,
	siteMetadata: {},
};
