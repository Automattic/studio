export type SyncSupport =
	| 'unsupported'
	| 'syncable'
	| 'needs-transfer'
	| 'already-connected'
	| 'needs-upgrade'
	| 'deleted'
	| 'missing-permissions';

export type SyncSite = {
	id: number;
	localSiteId: string;
	name: string;
	url: string;
	isStaging: boolean;
	isPressable: boolean;
	environment_type?: string;
	stagingSiteIds: number[];
	syncSupport: SyncSupport;
	lastPullTimestamp: string | null;
	lastPushTimestamp: string | null;
};
