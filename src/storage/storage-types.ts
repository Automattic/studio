import { SupportedEditor } from 'src/lib/editor';
import { StoredToken } from 'src/lib/oauth';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

export interface UserData {
	sites: SiteDetails[];
	snapshots: Snapshot[];
	devToolsOpen?: boolean;
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
	preferredEditor?: SupportedEditor;
}

export interface PersistedUserData extends Omit< UserData, 'sites' > {
	version: 1;

	// Users can edit the file system manually which would make UserData['name'] and UserData['path']
	// get out of sync. `name` is redundant because it can be calculated from `path`, so we
	// won't persist `name`.
	sites: Omit< StoppedSiteDetails, 'running' >[];
}

export type PromptWindowsSpeedUpResult = 'yes' | 'no';
