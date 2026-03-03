/**
 * Types for the WordPress Contributor Toolkit addon.
 */

export type RepoStatus = 'not-configured' | 'cloning' | 'ready' | 'error';
export type BuildStatus = 'idle' | 'running' | 'success' | 'error';

export interface CloneProgress {
	phase: string;
	loaded: number;
	total: number;
}

export interface WctSite {
	id: string;
	name: string;
	repoPath: string;
	siteId: string | null;
	repoStatus: RepoStatus;
	installStatus: BuildStatus;
	buildStatus: BuildStatus;
	watchStatus: BuildStatus;
}

export interface ContributorToolkitState {
	sites: WctSite[];
	activeSiteId: string | null;
	logLines: string[];
	changedFiles: string[];
	cloneProgress: CloneProgress | null;
}

export interface PatchResult {
	success: boolean;
	patchPath?: string;
	error?: string;
}
