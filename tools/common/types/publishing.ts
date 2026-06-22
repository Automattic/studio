export type DevelopmentProjectType = 'plugin' | 'theme';

export type DevelopmentProjectSource = 'manual' | 'clone';

export type WordPressOrgPluginRole = 'contributor' | 'committer';

export type RemoteDevelopmentPluginLocalState = 'cloned' | 'tracked' | 'missing' | 'not-cloned';

export type DevelopmentProjectVersionBump = 'patch' | 'minor' | 'major';

export type DevelopmentProjectVersionStateStatus =
	| 'ready'
	| 'duplicate_tag_blocked'
	| 'header_readme_mismatch'
	| 'remote_newer'
	| 'missing_version'
	| 'unknown_svn_state';

export interface PluginProjectInfo {
	rootDir: string;
	mainFile: string;
	readmePath?: string;
	name: string;
	slug: string;
	version?: string;
	stableTag?: string;
	description?: string;
	author?: string;
	textDomain?: string;
	requiresAtLeast?: string;
	testedUpTo?: string;
	requiresPhp?: string;
}

export interface DevelopmentProject {
	id: string;
	type: DevelopmentProjectType;
	source: DevelopmentProjectSource;
	path: string;
	name: string;
	slug: string;
	addedAt: string;
	updatedAt: string;
	exists: boolean;
	info?: PluginProjectInfo;
	error?: string;
	linkedSiteId?: string;
}

export interface RemoteDevelopmentPlugin {
	name: string;
	slug: string;
	url: string;
	author?: string;
	activeInstalls?: string;
	testedWith?: string;
	roles: WordPressOrgPluginRole[];
	localState: RemoteDevelopmentPluginLocalState;
	localProjectId?: string;
	localProjectSource?: DevelopmentProjectSource;
	localPath?: string;
}

export interface RemoteDevelopmentPluginsResult {
	username?: string;
	source: 'logged-in' | 'none';
	plugins: RemoteDevelopmentPlugin[];
}

export interface DevelopmentProjectVersionState {
	slug: string;
	name: string;
	path: string;
	localVersion?: string;
	readmeStableTag?: string;
	remoteVersion?: string;
	latestSvnTag?: string;
	svnTags?: string[];
	svnTagsSource: 'local' | 'remote' | 'unknown';
	statuses: DevelopmentProjectVersionStateStatus[];
	releaseBlocked: boolean;
	messages: string[];
	nextVersions?: Partial< Record< DevelopmentProjectVersionBump, string > >;
}

export interface DevelopmentProjectPlaygroundOptions {
	wpVersion?: string;
	phpVersion?: string;
	reset?: boolean;
}

export interface DevelopmentProjectPlaygroundResult {
	project: DevelopmentProject;
	siteId: string;
	siteName: string;
	sitePath: string;
	url?: string;
	running: boolean;
	wpVersion: string;
	phpVersion: string;
}

export interface PublishingConfig {
	version: 1;
	projects: DevelopmentProject[];
}

export interface WordPressOrgAccount {
	username: string;
	profileUrl: string;
	displayName?: string;
}
