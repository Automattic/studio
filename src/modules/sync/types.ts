export type RawDirectoryEntry = {
	name: string;
	isDirectory: boolean;
	path: string;
	children?: RawDirectoryEntry[];
};

export type SyncModalMode = 'push' | 'pull' | 'connect';

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
	environmentType?: string | null;
	syncSupport: SyncSupport;
	lastPullTimestamp: string | null;
	lastPushTimestamp: string | null;
};
