/**
 * Vendor the Data Liberation Agent (DLA) repository at a pinned git SHA into
 * `apps/cli/ai/dla/` for runtime use by the `studio code` CLI agent.
 *
 * Modeled on `scripts/download-agent-skills.ts`. See the canonical spec:
 *   issues/rsm-1639-dla-integration/research-report.md
 *
 * Behavior:
 *   1. Reads a pinned SHA from `DLA_PINNED_SHA` (one-line bump when updating).
 *   2. Authenticates against the private repo via `GH_PAT` or `GH_TOKEN`. When
 *      neither is set, logs a warning and exits 0 — installs MUST keep working
 *      for contributors without access; `/migrate` is gated on the vendored tree
 *      existing at runtime (see `apps/cli/ai/agent.ts`).
 *   3. Downloads the tarball at the pinned SHA, extracts to a temp dir.
 *   4. Pre-compiles DLA's TypeScript sources to JS via `tsc -p tsconfig.json
 *      --outDir dist-vendored` so the runtime does not depend on `tsx`.
 *   5. Copies a curated subset (`.claude-plugin/`, `skills/`, `commands/`,
 *      `prompts/`, the compiled `dist-vendored/` renamed to `src/`, plus the
 *      vendored PHP under `src/lib/preview/scripts/`) into `apps/cli/ai/dla/`.
 *   6. Writes `.dla-pinned-sha` for provenance.
 *   7. Skips DLA's own `node_modules` install — runtime deps are workspace-hoisted.
 *   8. Honors `--update` / `STUDIO_REFRESH_DLA=1` to refresh an existing tree.
 *
 * The exported `downloadDataLiberationAgent` function is also the test surface;
 * the bottom-of-file invocation only runs when this module is executed directly.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extract as tarExtract } from 'tar';

/**
 * Pinned DLA commit. Bumping this is a one-line change.
 *
 * TODO(rsm-1639 OQ6): replace with a real SHA before merge. `'main'` is a
 * placeholder so the script remains testable while the upstream private repo
 * does not yet publish tagged releases. Tracked in
 * `issues/rsm-1639-dla-integration/research-report.md` Open Question 6.
 */
const DLA_PINNED_SHA = 'main';

/**
 * Default destination — `<repo-root>/apps/cli/ai/dla`.
 * `__dirname` is `<repo-root>/scripts/` when this script is run via ts-node.
 */
const DEFAULT_DEST_DIR = path.resolve( __dirname, '..', 'apps', 'cli', 'ai', 'dla' );

const REPO_OWNER = 'Automattic';
const REPO_NAME = 'data-liberation-agent';

/**
 * Subdirectories to vendor verbatim from the extracted tarball into
 * `apps/cli/ai/dla/`. The compiled `dist-vendored/` → `src/` rename happens
 * separately after the tsc pass.
 */
const VENDORED_PATHS = [ '.claude-plugin', 'skills', 'commands', 'prompts' ] as const;

/**
 * Path inside DLA's source tree that contains PHP files referenced via
 * `import.meta.url` at runtime — must ship alongside compiled JS.
 */
const PREVIEW_PHP_PATH = path.join( 'src', 'lib', 'preview', 'scripts' );

interface DownloadOptions {
	/** Destination directory. Defaults to `apps/cli/ai/dla`. */
	destDir?: string;
	/** Pinned DLA git SHA to fetch. Defaults to `DLA_PINNED_SHA`. */
	pinnedSha?: string;
	/** Force a refresh even when `destDir` already exists. */
	forceUpdate?: boolean;
	/**
	 * Resolved GitHub token. `null` means "no token available — skip the fetch".
	 * Defaults to `process.env.GH_PAT ?? process.env.GH_TOKEN ?? null`.
	 */
	ghToken?: string | null;
	/** Injected `fetch`. Test seam. */
	fetchImpl?: typeof fetch;
	/** Injected TypeScript compiler runner. Test seam. */
	runCompiler?: ( cwd: string, tsconfigPath: string, outDir: string ) => Promise< void >;
}

/**
 * Resolves the GitHub token from the standard env vars used across our scripts.
 *
 * @returns The token string, or `null` when neither is set.
 */
function resolveGhToken(): string | null {
	return process.env.GH_PAT ?? process.env.GH_TOKEN ?? null;
}

/**
 * Recursively copies `src` into `dest`, creating directories as needed and
 * overwriting existing files. Skips silently when `src` does not exist.
 *
 * @param src  Source path.
 * @param dest Destination path.
 */
function copyRecursive( src: string, dest: string ): void {
	if ( ! fs.existsSync( src ) ) {
		return;
	}
	fs.cpSync( src, dest, { recursive: true } );
}

/**
 * Default `tsc` runner. Spawns the project-local `tsc` binary against the
 * extracted tree's `tsconfig.json`, writing output to `<cwd>/<outDir>`.
 *
 * @param cwd          Working directory (the extracted DLA root).
 * @param tsconfigPath Tsconfig path relative to `cwd`.
 * @param outDir       Output directory relative to `cwd`.
 */
async function defaultRunCompiler(
	cwd: string,
	tsconfigPath: string,
	outDir: string
): Promise< void > {
	await new Promise< void >( ( resolve, reject ) => {
		// `npx --no-install` ensures we use the workspace-hoisted `tsc`; failing
		// fast (rather than auto-installing) keeps the install hermetic.
		const child = spawn( 'npx', [ '--no-install', 'tsc', '-p', tsconfigPath, '--outDir', outDir ], {
			cwd,
			stdio: 'inherit',
		} );
		child.on( 'error', ( err ) => {
			reject(
				new Error(
					`Failed to spawn tsc: ${
						( err as Error ).message
					}. Install TypeScript or pass --no-compile.`
				)
			);
		} );
		child.on( 'exit', ( code ) => {
			if ( code === 0 ) {
				resolve();
				return;
			}
			reject( new Error( `tsc exited with code ${ code }` ) );
		} );
	} );
}

/**
 * Downloads the DLA tarball and writes the curated subset into `destDir`.
 *
 * @param options Configuration. See {@link DownloadOptions}.
 * @returns Process-style exit code (0 for success or graceful skip).
 */
export async function downloadDataLiberationAgent(
	options: DownloadOptions = {}
): Promise< number > {
	const destDir = options.destDir ?? DEFAULT_DEST_DIR;
	const pinnedSha = options.pinnedSha ?? DLA_PINNED_SHA;
	const forceUpdate = options.forceUpdate ?? process.env.STUDIO_REFRESH_DLA === '1';
	const ghToken = options.ghToken !== undefined ? options.ghToken : resolveGhToken();
	const fetchImpl = options.fetchImpl ?? fetch;
	const runCompiler = options.runCompiler ?? defaultRunCompiler;

	if ( ! ghToken ) {
		console.warn(
			'[dla] Skipping DLA download — set GH_PAT to enable. /migrate will not work until DLA is vendored.'
		);
		return 0;
	}

	if ( fs.existsSync( destDir ) && ! forceUpdate ) {
		console.log(
			`[dla] ${ destDir } already exists. Pass --update or STUDIO_REFRESH_DLA=1 to refresh.`
		);
		return 0;
	}

	const tmpRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-dla-' ) );
	const tarballPath = path.join( tmpRoot, 'dla.tar.gz' );
	const extractDir = path.join( tmpRoot, 'extracted' );
	fs.mkdirSync( extractDir, { recursive: true } );

	try {
		console.log( `[dla] Downloading DLA at ${ pinnedSha }…` );
		const url = `https://api.github.com/repos/${ REPO_OWNER }/${ REPO_NAME }/tarball/${ pinnedSha }`;
		const response = await fetchImpl( url, {
			headers: {
				Authorization: `Bearer ${ ghToken }`,
				Accept: 'application/vnd.github+json',
				'User-Agent': 'studio-cli',
			},
		} );

		if ( ! response.ok ) {
			throw new Error(
				`Failed to download DLA tarball: ${ response.status } ${ response.statusText }`
			);
		}

		const buffer = Buffer.from( await response.arrayBuffer() );
		fs.writeFileSync( tarballPath, buffer );

		console.log( '[dla] Extracting tarball…' );
		await tarExtract( { file: tarballPath, cwd: extractDir } );

		// GitHub tarballs nest under a single `<owner>-<repo>-<short-sha>/` directory.
		const entries = fs.readdirSync( extractDir, { withFileTypes: true } );
		const repoDirEntry = entries.find( ( e ) => e.isDirectory() );
		if ( ! repoDirEntry ) {
			throw new Error( 'Extracted tarball did not contain a top-level directory' );
		}
		const repoDir = path.join( extractDir, repoDirEntry.name );

		console.log( '[dla] Compiling TypeScript sources…' );
		try {
			await runCompiler( repoDir, 'tsconfig.json', 'dist-vendored' );
		} catch ( err ) {
			throw new Error(
				`[dla] tsc failed: ${
					( err as Error ).message
				}. Ensure TypeScript is installed in the workspace.`
			);
		}

		// Stage everything in a temp destination and move atomically at the end so a
		// failure mid-copy does not leave a half-vendored tree on disk.
		const stagingDir = path.join( tmpRoot, 'staging' );
		fs.mkdirSync( stagingDir, { recursive: true } );

		for ( const sub of VENDORED_PATHS ) {
			copyRecursive( path.join( repoDir, sub ), path.join( stagingDir, sub ) );
		}

		// `dist-vendored/` becomes `src/` so runtime imports like
		// `path.resolve(import.meta.dirname, 'dla/src/mcp-server.js')` keep working.
		const compiledOut = path.join( repoDir, 'dist-vendored' );
		const stagedSrc = path.join( stagingDir, 'src' );
		copyRecursive( compiledOut, stagedSrc );

		// Re-overlay the original PHP files onto `src/lib/preview/scripts/` —
		// `tsc` does not emit non-TS assets and these are loaded at runtime via
		// `import.meta.url`.
		copyRecursive(
			path.join( repoDir, PREVIEW_PHP_PATH ),
			path.join( stagedSrc, 'lib', 'preview', 'scripts' )
		);

		fs.writeFileSync( path.join( stagingDir, '.dla-pinned-sha' ), `${ pinnedSha }\n` );

		// Atomic-ish swap: remove old destination, then rename staging in.
		fs.rmSync( destDir, { recursive: true, force: true } );
		fs.mkdirSync( path.dirname( destDir ), { recursive: true } );
		fs.renameSync( stagingDir, destDir );

		console.log( `[dla] Vendored DLA into ${ destDir }` );
		return 0;
	} finally {
		fs.rmSync( tmpRoot, { recursive: true, force: true } );
	}
}

/**
 * CLI entrypoint. Parses `--update` from argv and forwards to the downloader.
 * Errors are caught and converted to non-zero exit codes; unset tokens are NOT
 * an error (graceful skip — see top-of-file rationale).
 */
async function main(): Promise< number > {
	const forceUpdate = process.argv.includes( '--update' );
	try {
		return await downloadDataLiberationAgent( { forceUpdate } );
	} catch ( err ) {
		console.error( `[dla] ${ ( err as Error ).message }` );
		return 1;
	}
}

if ( require.main === module ) {
	void main().then( ( code ) => process.exit( code ) );
}
