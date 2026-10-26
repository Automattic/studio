import { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import { StatsMetric } from 'src/lib/bump-stats';
import type { AiSessionSitePlacement } from '@studio/common/ai/sessions/placement';
import type { QuitSitesBehavior } from '@studio/common/lib/user-settings/preferences';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';

export interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	isFullScreen?: boolean;
}

export type { QuitSitesBehavior };

interface AppdataSiteData {
	sortOrder?: number;
	autoStart?: boolean;
}

interface NightlyPromptResult {
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
	preferredTerminal?: SupportedTerminal;
	preferredEditor?: SupportedEditor;
	colorScheme?: 'system' | 'light' | 'dark';
	/** Beta features the user opted into, by key. Migration 09 removes the classic-era `enableAgenticUi`. */
	betaFeatures?: Record< string, boolean >;
	quitSitesBehavior?: QuitSitesBehavior;
	defaultSiteDirectory?: string;
	cliUserUninstalled?: boolean;
	wapuuScore?: number;
	aiSessionPlacements?: Record< string, AiSessionSitePlacement >;
	lastNightlyUpdateCheck?: number;
	nightlyPromptResult?: NightlyPromptResult;
	dontShowArm64Warning?: boolean;
	// Whether chat/agent features are offered in the UI.
	agenticFeaturesEnabled?: boolean;
	/** Agentic UI onboarding state (orientation tour, getting-started checklist). Opaque blob owned by the renderer. */
	onboardingHints?: OnboardingHintsState;
}

interface PromptWindowsSpeedUpResult {
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
	migratedFromClassic?: boolean;
	whatsNewSeenVersion?: number;
}

export const EMPTY_USER_DATA: UserData = {
	version: 1,
	siteMetadata: {},
};
