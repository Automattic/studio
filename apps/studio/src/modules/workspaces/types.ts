import type { SyncSite } from '@studio/common/types/sync';

export type WorkspaceTargetId = 'local' | 'production' | 'staging';

export type LocalTarget = {
	id: 'local';
	kind: 'local';
	siteId: string;
	site: SiteDetails;
};

export type RemoteTargetId = Extract< WorkspaceTargetId, 'production' | 'staging' >;

export type RemoteTarget = {
	id: RemoteTargetId;
	kind: 'remote';
	siteId: number;
	site: SyncSite;
};

export type WorkspaceSyncLink = {
	id: string;
	source: WorkspaceTargetId;
	target: WorkspaceTargetId;
	status: 'available';
};

export type WorkspaceActivity = {
	status: 'idle';
};

export type StudioWorkspace = {
	id: string;
	name: string;
	sortOrder?: number;
	targets: {
		local?: LocalTarget;
		production?: RemoteTarget;
		staging?: RemoteTarget;
	};
	syncLinks: WorkspaceSyncLink[];
	activity: WorkspaceActivity;
};

export type BuildStudioWorkspacesInput = {
	localSites?: SiteDetails[];
	wpcomSites?: SyncSite[];
	connectedSites?: SyncSite[];
};
