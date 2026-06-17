import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

/**
 * Per-session workspace for Studio Web — the cloud analog of Studio App's local
 * site layer, and the answer to "where does the agent build, and where does it
 * persist". Each session gets its own git-backed working directory that the
 * forked agent operates on as its active site.
 *
 * "git-backed" is deliberate: it's the project container Studio Web is intended
 * to use (Matt B's git-as-project-container proposal) — `git status` is the
 * change set and a later `git push` is the publish/deploy step. This increment
 * only reads the workspace for the live preview; the draft/publish surface is a
 * follow-up.
 *
 * (The workspace lives under STUDIO_SITES_ROOT so the agent's file tools —
 * scoped to that root — can reach it without relocating HOME, which would move
 * session storage too.)
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

// Session ids come from HTTP requests. They're UUIDs, but validate before using
// one in a filesystem path — derive the slug from an allowlisted slice only.
function safeSessionToken( sessionId: string ): string {
	if ( ! /^[a-zA-Z0-9-]+$/.test( sessionId ) ) {
		throw new Error( `Invalid session id: ${ sessionId }` );
	}
	// The slug only ever contains these chars — no path separators can survive.
	return sessionId.replace( /[^a-zA-Z0-9]/g, '' ).slice( 0, 8 );
}

/** The workspace identity for a session (slug/name/path), without touching disk. */
export function workspaceFor( sessionId: string ): Workspace {
	const token = safeSessionToken( sessionId );
	const slug = `${ WORKSPACE_PREFIX }-${ token }`;
	const workspacePath = path.join( STUDIO_SITES_ROOT, slug );
	// Containment check: even with the token allowlist above, confirm the
	// resolved path stays inside STUDIO_SITES_ROOT before anything touches the
	// filesystem with it — a crafted session id must not escape the sites root
	// (defends against CodeQL js/path-injection).
	const relative = path.relative( STUDIO_SITES_ROOT, workspacePath );
	if ( relative.startsWith( '..' ) || path.isAbsolute( relative ) ) {
		throw new Error( `Workspace path escapes the sites root: ${ sessionId }` );
	}
	return { name: `Studio Web (${ token })`, slug, path: workspacePath };
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

export interface WorkspaceFile {
	/** Path relative to the workspace root, POSIX-separated (e.g. 'wp-content/themes/foo/style.css'). */
	path: string;
	/** File contents, base64-encoded so binary assets survive the JSON round-trip. */
	contentBase64: string;
}

// Guardrails so a runaway workspace can't produce an unbounded preview payload.
const MAX_PREVIEW_FILES = 2000;
const MAX_PREVIEW_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file (covers a small SQLite DB)

// The SQLite database, when the agent built a real WP install in the workspace.
// It's gitignored (not deployable code), but the preview overlays it so the
// browser shows the agent's actual content, not an empty install.
const PREVIEW_DB_PATH = 'wp-content/database/.ht.sqlite';

function readWorkspaceFile( cwd: string, relPath: string ): WorkspaceFile | undefined {
	const absPath = path.join( cwd, relPath );
	let stat: fs.Stats;
	try {
		stat = fs.statSync( absPath );
	} catch {
		return undefined; // listed but gone (race with a concurrent agent edit)
	}
	if ( ! stat.isFile() || stat.size > MAX_PREVIEW_FILE_BYTES ) {
		return undefined;
	}
	return { path: relPath, contentBase64: fs.readFileSync( absPath ).toString( 'base64' ) };
}

/**
 * The workspace's files for the client-side Playground preview: the deployable
 * code the agent wrote (tracked + untracked, .gitignore respected) plus the
 * SQLite database if one exists, so the preview reflects real content. Empty for
 * sessions whose workspace hasn't been created yet. Files over the per-file cap
 * are skipped.
 */
export function getWorkspaceFiles( sessionId: string ): WorkspaceFile[] {
	const { path: cwd } = workspaceFor( sessionId );
	if ( ! fs.existsSync( path.join( cwd, '.git' ) ) ) {
		return [];
	}
	// `--cached --others --exclude-standard` = tracked + untracked, honoring
	// .gitignore — the same deployable set publish will operate on.
	const listing = gitOut( cwd, [ 'ls-files', '--cached', '--others', '--exclude-standard' ] );
	const relPaths = listing ? listing.split( '\n' ) : [];
	// The DB is gitignored, so add it explicitly (preview needs it for content).
	if ( fs.existsSync( path.join( cwd, PREVIEW_DB_PATH ) ) ) {
		relPaths.push( PREVIEW_DB_PATH );
	}

	const files: WorkspaceFile[] = [];
	for ( const relPath of relPaths ) {
		if ( files.length >= MAX_PREVIEW_FILES ) {
			break;
		}
		const file = readWorkspaceFile( cwd, relPath );
		if ( file ) {
			files.push( file );
		}
	}
	return files;
}
