import { StatsMetric } from 'src/lib/bump-stats';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import type { SyncSite } from 'src/modules/sync/types';
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

export interface UserData {
	sites: Record< string, AppdataSiteData >;
	devToolsOpen?: boolean;
	windowBounds?: WindowBounds;
	onboardingCompleted?: boolean;
	lastBumpStats?: Record< string, Partial< Record< StatsMetric, number > > >;
	promptWindowsSpeedUpResult?: PromptWindowsSpeedUpResult;
	connectedWpcomSites?: { [ userId: number ]: SyncSite[] };
	sentryUserId?: string;
	lastSeenVersion?: string;
	preferredTerminal?: SupportedTerminal;
	preferredEditor?: SupportedEditor;
	betaFeatures?: BetaFeatures;
	stopSitesOnQuit?: boolean;
}

export interface PersistedUserData extends UserData {
	version: number;
}

export interface PromptWindowsSpeedUpResult {
	response: 'yes' | 'no';
	appVersion: string;
	dontAskAgain: boolean;
}
