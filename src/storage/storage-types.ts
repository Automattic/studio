import { StoredToken } from '../lib/oauth';

export interface UserData {
	sites: SiteDetails[];
	snapshots: Snapshot[];
	devToolsOpen?: boolean;
	authToken?: StoredToken;
	lastBumpStats?: {
		[ group: string ]: {
			[ stat: string ]: number;
		};
	};
}

export interface PersistedUserData extends Omit< UserData, 'sites' > {
	version: 1;

	// Users can edit the file system manually which would make UserData['name'] and UserData['path']
	// get out of sync. `name` is redundant because it can be calculated from `path`, so we
	// won't persist `name`.
	sites: Omit< StoppedSiteDetails, 'name' | 'running' >[];
}
