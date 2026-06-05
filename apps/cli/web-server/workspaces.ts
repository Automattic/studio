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

function git( cwd: string, args: string[] ): void {
	execFileSync( 'git', args, {
		cwd,
		stdio: 'ignore',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Studio Web',
			GIT_AUTHOR_EMAIL: 'studio-web@local',
			GIT_COMMITTER_NAME: 'Studio Web',
			GIT_COMMITTER_EMAIL: 'studio-web@local',
		},
	} );
}

/**
 * Ensure a git-backed workspace exists for `sessionId` and return it. Idempotent:
 * an existing workspace is returned untouched so re-runs of a session reuse it.
 */
export function ensureWorkspace( sessionId: string ): Workspace {
	const slug = `${ WORKSPACE_PREFIX }-${ sessionId.slice( 0, 8 ) }`;
	const workspacePath = path.join( STUDIO_SITES_ROOT, slug );
	const name = `Studio Web (${ sessionId.slice( 0, 8 ) })`;

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

	return { name, slug, path: workspacePath };
}
