import type { JsonEvent } from '../ai/json-events';

export type DevelopmentProjectType = 'plugin' | 'theme';

export type DevelopmentProjectSource = 'manual' | 'clone';

export type WordPressOrgPluginRole = 'contributor' | 'committer';

export type RemoteDevelopmentPluginLocalState = 'cloned' | 'tracked' | 'missing' | 'not-cloned';

export type DevelopmentProjectVersionBump = 'patch' | 'minor' | 'major';
export type DevelopmentProjectFileKind = 'text' | 'image';
export type DevelopmentProjectFileMode = 'code' | 'preview';

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

export interface DevelopmentProjectReleaseTag {
	name: string;
	path?: string;
	isCurrent: boolean;
	isUncommitted: boolean;
	isTrunk?: boolean;
}

export interface DevelopmentProjectReleaseTagList {
	slug: string;
	svnRootDir?: string;
	currentRef?: string;
	trunk?: DevelopmentProjectReleaseTag;
	tags: DevelopmentProjectReleaseTag[];
	source: 'local' | 'remote' | 'unknown';
}

export interface DevelopmentProjectReleaseTagSwitchResult {
	ref: string;
	project: DevelopmentProject;
	tags: DevelopmentProjectReleaseTagList;
}

export interface DevelopmentProjectFile {
	path: string;
	name: string;
	directory: string;
	size: number;
	extension?: string;
	fileKind: DevelopmentProjectFileKind;
	mediaType?: string;
	editable: boolean;
	previewable: boolean;
	ignored?: boolean;
	ignoredBy?: string;
}

export interface DevelopmentProjectFileContent {
	path: string;
	content: string;
	fileKind: DevelopmentProjectFileKind;
	mediaType?: string;
	dataUrl?: string;
	editable: boolean;
	previewable: boolean;
	mode: DevelopmentProjectFileMode;
	updatedAt?: string;
}

export interface DevelopmentProjectDirectory {
	path: string;
	name: string;
	parent: string;
	ignored?: boolean;
	ignoredBy?: string;
}

export interface DevelopmentProjectFilesResult {
	files: DevelopmentProjectFile[];
	directories: DevelopmentProjectDirectory[];
	truncated: boolean;
}

export type DevelopmentProjectValidationSeverity = 'error' | 'warning' | 'info';

export type DevelopmentProjectValidationSource = 'readme' | 'plugin-check';

export interface DevelopmentProjectValidationFinding {
	source: DevelopmentProjectValidationSource;
	severity: DevelopmentProjectValidationSeverity;
	message: string;
	code?: string;
	file?: string;
	line?: number;
	column?: number;
}

export interface DevelopmentProjectValidationSummary {
	error: number;
	warning: number;
	info: number;
	total: number;
	readme: number;
	pluginCheck: number;
}

export interface DevelopmentProjectValidationResult {
	checkedAt: string;
	findings: DevelopmentProjectValidationFinding[];
	summary: DevelopmentProjectValidationSummary;
	pluginCheckAvailable: boolean;
	rawPluginCheckOutput?: string;
}

export type DevelopmentProjectValidationState =
	| {
			status: 'idle';
	  }
	| {
			status: 'running';
			startedAt: string;
			previousResult?: DevelopmentProjectValidationResult;
	  }
	| {
			status: 'completed';
			startedAt: string;
			completedAt: string;
			result: DevelopmentProjectValidationResult;
	  }
	| {
			status: 'failed';
			startedAt: string;
			completedAt: string;
			error: string;
			previousResult?: DevelopmentProjectValidationResult;
	  };

export interface DevelopmentProjectAiPatch {
	path: string;
	status: 'created' | 'modified' | 'deleted';
	beforeContent?: string;
	afterContent?: string;
}

export interface DevelopmentProjectAiReviewOptions {
	prompt: string;
	selectedPath?: string;
	includeAllPluginCheckFindings?: boolean;
}

export interface DevelopmentProjectAiReviewResult {
	sessionId: string;
	patches: DevelopmentProjectAiPatch[];
}

export type DevelopmentProjectAiReviewRunEvent =
	| {
			type: 'run.started';
			timestamp: string;
	  }
	| {
			type: 'run.exited';
			timestamp: string;
			status: 'success' | 'error';
			code: number | null;
	  };

export interface DevelopmentProjectAiReviewEvent {
	projectId: string;
	sessionId: string;
	event: JsonEvent | DevelopmentProjectAiReviewRunEvent;
}

export interface DevelopmentProjectChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
}

export interface DevelopmentProjectChatState {
	projectId: string;
	messages: DevelopmentProjectChatMessage[];
	updatedAt?: string;
}

export interface DevelopmentProjectAiPatchResult {
	files: DevelopmentProjectFile[];
	directories: DevelopmentProjectDirectory[];
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
