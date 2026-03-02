import { Snapshot } from '@studio/common/types/snapshot';
import { StoredToken } from 'src/lib/oauth';
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

export interface UserData {
	sites: SiteDetails[];
	snapshots: Snapshot[];
	devToolsOpen?: boolean;
	windowBounds?: WindowBounds;
	authToken?: StoredToken;
	onboardingCompleted?: boolean;
	locale?: string;
	lastBumpStats?: {
		[ group: string ]: {
			[ stat: string ]: number;
		};
	};
	promptWindowsSpeedUpResult?: PromptWindowsSpeedUpResult;
	connectedWpcomSites?: { [ userId: number ]: SyncSite[] };
	sentryUserId?: string;
	lastSeenVersion?: string;
	preferredTerminal?: SupportedTerminal;
	preferredEditor?: SupportedEditor;
	betaFeatures?: BetaFeatures;
	stopSitesOnQuit?: boolean;
	addonData?: Record< string, unknown >;
	enabledAddonIds?: string[];
}

export interface PersistedUserData extends Omit< UserData, 'sites' > {
	version: 1;

	// Users can edit the file system manually which would make UserData['name'] and UserData['path']
	// get out of sync. `name` is redundant because it can be calculated from `path`, so we
	// won't persist `name`.
	sites: Omit< StoppedSiteDetails, 'running' >[];
}

export interface PromptWindowsSpeedUpResult {
	response: 'yes' | 'no';
	appVersion: string;
	dontAskAgain: boolean;
}
