export type CpanelSyncSite = {
	id: string; // generated UUID
	localSiteId: string;
	hostname: string;
	port: number; // default 2083
	username: string;
	apiToken: string;
	wpPath: string; // relative to cPanel home, e.g. 'public_html'
	dbName: string;
	lastPullTimestamp: string | null;
};

export type CpanelPullStatusKey =
	| 'compressing'
	| 'downloading'
	| 'exporting-db'
	| 'building-archive'
	| 'importing'
	| 'finished'
	| 'failed'
	| 'cancelled';

export type CpanelPullStatusInfo = {
	key: CpanelPullStatusKey;
	progress: number;
	message: string;
};

export type CpanelPullState = {
	cpanelSiteId: string;
	selectedSite: SiteDetails;
	status: CpanelPullStatusInfo;
};
