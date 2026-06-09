import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

/**
 * Per-session workspace for Studio Web — the cloud analog of Studio App's local
 * site layer. Each session gets its own git-backed working directory that the
 * agent operates on as its active site. (PoC: the workspace lives under
 * STUDIO_SITES_ROOT so the agent's file tools — scoped to that root — can reach
 * it without relocating HOME, which would move session storage too.)
 *
 * "git-backed" is deliberate: it's the project container Studio Web will use
 * instead of Telex's artefact.xml/S3 — `git status` is the change set and a
 * later `git push` is the publish/deploy step (WordPress.com GitHub Deployments).
 */

const WORKSPACE_PREFIX = 'studio-web';

export interface Workspace {
	name: string;
	slug: string;
	path: string;
}

const GIT_ENV = {
	GIT_AUTHOR_NAME: 'Studio Web',
	GIT_AUTHOR_EMAIL: 'studio-web@local',
	GIT_COMMITTER_NAME: 'Studio Web',
	GIT_COMMITTER_EMAIL: 'studio-web@local',
};

function git( cwd: string, args: string[] ): void {
	execFileSync( 'git', args, { cwd, stdio: 'ignore', env: { ...process.env, ...GIT_ENV } } );
}

function gitOut( cwd: string, args: string[] ): string {
	return execFileSync( 'git', args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, ...GIT_ENV },
	} ).trim();
}

/**
 * The workspace identity for a session (slug/name/path), without touching disk.
 * `ensureWorkspace` creates it; the `changes`/`publish` helpers only read it.
 */
export function workspaceFor( sessionId: string ): Workspace {
	const slug = `${ WORKSPACE_PREFIX }-${ sessionId.slice( 0, 8 ) }`;
	return {
		name: `Studio Web (${ sessionId.slice( 0, 8 ) })`,
		slug,
		path: path.join( STUDIO_SITES_ROOT, slug ),
	};
}

/**
 * Ensure a git-backed workspace exists for `sessionId` and return it. Idempotent:
 * an existing workspace is returned untouched so re-runs of a session reuse it.
 */
export function ensureWorkspace( sessionId: string ): Workspace {
	const workspace = workspaceFor( sessionId );
	const workspacePath = workspace.path;

	if ( ! fs.existsSync( workspacePath ) ) {
		fs.mkdirSync( workspacePath, { recursive: true } );
	}
	if ( ! fs.existsSync( path.join( workspacePath, '.git' ) ) ) {
		fs.writeFileSync(
			path.join( workspacePath, '.gitignore' ),
			// Track deployable code only, like a WordPress.com GitHub Deployments repo.
			[ '/wp-content/uploads/', '/wp-content/database/', '**/*.sqlite', '.DS_Store', '' ].join(
				'\n'
			)
		);
		git( workspacePath, [ 'init', '-b', 'main' ] );
		git( workspacePath, [ 'add', '-A' ] );
		git( workspacePath, [ 'commit', '--allow-empty', '-m', 'studio-web: workspace baseline' ] );
	}

	return workspace;
}

export interface WorkspaceChange {
	/** Two-letter git porcelain status (e.g. 'M', 'A', '??'), trimmed. */
	status: string;
	file: string;
}

/**
 * The session's draft change set — `git status` is what the agent has touched
 * but not yet published. Empty for sessions without a workspace yet.
 */
export function getWorkspaceChanges( sessionId: string ): WorkspaceChange[] {
	const { path: cwd } = workspaceFor( sessionId );
	if ( ! fs.existsSync( path.join( cwd, '.git' ) ) ) {
		return [];
	}
	const out = gitOut( cwd, [ 'status', '--porcelain' ] );
	if ( ! out ) {
		return [];
	}
	return out.split( '\n' ).map( ( line ) => ( {
		status: line.slice( 0, 2 ).trim(),
		file: line.slice( 3 ),
	} ) );
}

export interface WorkspaceFile {
	/** Path relative to the workspace root, POSIX-separated (e.g. 'wp-content/themes/foo/style.css'). */
	path: string;
	/** File contents, base64-encoded so binary assets survive the JSON round-trip. */
	contentBase64: string;
}

// Guardrails so a runaway workspace can't produce an unbounded preview payload.
// The browser only needs the deployable code the agent wrote; uploads/DB/sqlite
// are already excluded by .gitignore (see ensureWorkspace).
const MAX_PREVIEW_FILES = 2000;
const MAX_PREVIEW_FILE_BYTES = 5 * 1024 * 1024; // 5 MB per file

/**
 * The workspace's deployable files (tracked + untracked, .gitignore respected)
 * as path → base64 content. This is what the browser overlays onto a client-side
 * WordPress Playground to render a live preview of what the agent built. Empty
 * for sessions without a workspace yet. Files over the per-file cap are skipped.
 */
export function getWorkspaceFiles( sessionId: string ): WorkspaceFile[] {
	const { path: cwd } = workspaceFor( sessionId );
	if ( ! fs.existsSync( path.join( cwd, '.git' ) ) ) {
		return [];
	}
	// `--cached --others --exclude-standard` = tracked + untracked, honoring
	// .gitignore — i.e. the same deployable set `git status`/publish operate on.
	const listing = gitOut( cwd, [ 'ls-files', '--cached', '--others', '--exclude-standard' ] );
	if ( ! listing ) {
		return [];
	}
	const files: WorkspaceFile[] = [];
	for ( const relPath of listing.split( '\n' ) ) {
		if ( files.length >= MAX_PREVIEW_FILES ) {
			break;
		}
		const absPath = path.join( cwd, relPath );
		let stat: fs.Stats;
		try {
			stat = fs.statSync( absPath );
		} catch {
			continue; // listed but gone (race with a concurrent agent edit)
		}
		if ( ! stat.isFile() || stat.size > MAX_PREVIEW_FILE_BYTES ) {
			continue;
		}
		files.push( {
			path: relPath,
			contentBase64: fs.readFileSync( absPath ).toString( 'base64' ),
		} );
	}
	return files;
}

export interface PublishResult {
	/** False when the draft was already clean (nothing to publish). */
	published: boolean;
	sha?: string;
	changedFiles: string[];
	/** Whether the commit was pushed to a deploy remote (`origin`), if configured. */
	pushed: boolean;
}

/**
 * Publish the session's draft: snapshot the working tree as a commit. If a
 * deploy remote (`origin`) is configured, also push it — the hosted product's
 * deploy step (WordPress.com GitHub Deployments). In the local PoC there's no
 * origin, so publish just records the reviewable commit.
 */
export function publishWorkspace( sessionId: string ): PublishResult {
	const { path: cwd } = workspaceFor( sessionId );
	const changes = getWorkspaceChanges( sessionId );
	if ( changes.length === 0 ) {
		return { published: false, changedFiles: [], pushed: false };
	}

	git( cwd, [ 'add', '-A' ] );
	git( cwd, [ 'commit', '-m', 'studio-web: publish' ] );
	const sha = gitOut( cwd, [ 'rev-parse', 'HEAD' ] );

	let pushed = false;
	if ( gitOut( cwd, [ 'remote' ] ).split( '\n' ).includes( 'origin' ) ) {
		git( cwd, [ 'push', 'origin', 'main' ] );
		pushed = true;
	}

	return { published: true, sha, changedFiles: changes.map( ( c ) => c.file ), pushed };
}
