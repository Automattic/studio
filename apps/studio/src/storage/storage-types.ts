import { StatsMetric } from 'src/lib/bump-stats';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import type { AiSessionSitePlacement } from '@studio/common/ai/sessions/placement';
import type { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';

export interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	isFullScreen?: boolean;
}

export type QuitSitesBehavior = 'stop' | 'stop-and-auto-start' | 'leave-running';

export interface AppdataSiteData {
	themeDetails?: SiteDetails[ 'themeDetails' ];
	siteIconPath?: SiteDetails[ 'siteIconPath' ];
	sortOrder?: number;
	autoStart?: boolean;
	// The last runtime stat counted for this site, and when (Unix ms). Dedupes
	// the daily per-site runtime bump so restarts don't inflate it, while still
	// re-counting when the day rolls over or the runtime/file-access choice changes.
	runtimeStatBumpedAt?: number;
	runtimeStat?: string;
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
	quitSitesBehavior?: QuitSitesBehavior;
	defaultSiteDirectory?: string;
	/** @deprecated Used only for migration to cliUserUninstalled. Do not write; remove after one release cycle. */
	cliAutoInstalled?: boolean;
	cliUserUninstalled?: boolean;
	wapuuScore?: number;
	/** Agentic UI chat gating preference. Absent means enabled. */
	agenticFeaturesEnabled?: boolean;
	/** OS notifications for chat activity. Absent means enabled. */
	chatNotificationsEnabled?: boolean;
	/** Persistent-message ids (update cards, announcements) the user dismissed. */
	dismissedMessages?: string[];
	/** Agentic UI onboarding state (orientation tour, getting-started checklist). Opaque blob owned by the renderer. */
	onboardingHints?: OnboardingHintsState;
	aiSessionPlacements?: Record< string, AiSessionSitePlacement >;
	lastNightlyUpdateCheck?: number;
	nightlyPromptResult?: NightlyPromptResult;
	agenticUiBannerDismissed?: boolean;
}

export interface PromptWindowsSpeedUpResult {
	response: 'yes' | 'no';
	appVersion: string;
	dontAskAgain: boolean;
}

// Mirror of the renderer's OnboardingHintsState (apps/ui/src/data/core/types.ts).
// Persisted verbatim; the desktop never inspects it, so a structural shape keeps
// the two sides decoupled.
export interface OnboardingHintsState {
	tourCompletedVersion?: number;
	tourDismissedVersion?: number;
	checklistDismissed?: boolean;
	checklistMinimized?: boolean;
	completedItems?: Record< string, string >;
	publishCoachmarkShown?: boolean;
}

export const EMPTY_USER_DATA: UserData = {
	version: 1,
	siteMetadata: {},
};
