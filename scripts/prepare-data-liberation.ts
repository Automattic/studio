// Prepares the Data Liberation engine (https://github.com/Automattic/data-liberation-agent)
// as a BUILD-TIME asset so the packaged Studio app never has to clone/install it
// on the user's machine (no runtime git/npm/Node-version dependency).
//
// It downloads a pinned release archive, `npm ci`s it, and compiles it to `dist/`
// (the engine ships a `build` script + `copy-runtime-assets.mjs` precisely so its
// MCP server runs from compiled JS — `node dist/mcp-server.js` — instead of tsx).
// The result lands in `packages/data-liberation-agent` (the location it will
// migrate to as a real workspace package), which `write-dist-extras`
// (apps/cli/vite.config.base.ts) copies into `dist/cli/data-liberation-agent`,
// like `ai/skills`. The bridge tool (apps/cli/ai/tools/data-liberation.ts) then
// spawns the compiled server with the bundled Node.
//
// The browser is intentionally NOT downloaded here (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD):
// the Studio CLI already depends on playwright and installs chromium on demand into
// the shared OS cache, which the engine reuses.
//
// Idempotent + gated (skip if already built); delete the target dir to rebuild.
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { downloadFile } from '../tools/common/lib/download-file';
import { extractZip } from '../tools/common/lib/extract-zip';

const ENGINE_REF = 'main';
const ENGINE_ARCHIVE_URL = `https://github.com/Automattic/data-liberation-agent/archive/refs/heads/${ ENGINE_REF }.zip`;
const ENGINE_DIR = path.join( import.meta.dirname, '..', 'packages', 'data-liberation-agent' );

function run( command: string, args: string[], cwd: string ): void {
	const result = spawnSync( command, args, {
		cwd,
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
	} );
	if ( result.status !== 0 ) {
		throw new Error( `Command failed: ${ [ command, ...args ].join( ' ' ) }` );
	}
}

// `tsc` emits only `.js`; non-TS runtime assets (e.g. `core-block-attrs.json`)
// that the compiled server reads at load time must be mirrored from `src/` into
// `dist/`. The engine's own copy step covers only `.php`, so this generalizes it
// (and is resilient to new asset types the engine adds).
async function mirrorRuntimeAssets( engineDir: string ): Promise< void > {
	const isAsset = ( src: string ): boolean =>
		! /\.(ts|tsx)$/.test( src ) && ! /(\.test\.|__fixtures__|__snapshots__)/.test( src );
	await fs.copy( path.join( engineDir, 'src' ), path.join( engineDir, 'dist' ), {
		overwrite: false,
		filter: isAsset,
	} );
}

// The engine ships as a raw `npm install` (it runs from its own node_modules as a
// child process), so it carries ~34MB of files that never execute at runtime. Strip
// them after the build to keep the packaged app lean:
//  - non-runtime top-level dirs/files (sources, tests, build scripts, docs, lockfile);
//    the engine runs from `dist/`, and `mirrorRuntimeAssets` already copied any data
//    assets out of `src/` into `dist/`.
//  - sourcemaps, type declarations, and markdown inside node_modules — pure dev cruft.
// Conservative on purpose: keep `skills/` (the bridge tool reads it), `prompts/`, and
// every package's actual code. Idempotent — `fs.remove` no-ops on missing paths.
const NON_RUNTIME_ENTRIES = [
	'src',
	'test',
	'tests',
	'scripts',
	'docs',
	'DISCOVERIES.md',
	'package-lock.json',
	'tsconfig.json',
	'tsconfig.build.json',
];

async function pruneEngine( engineDir: string ): Promise< void > {
	await Promise.all(
		NON_RUNTIME_ENTRIES.map( ( entry ) => fs.remove( path.join( engineDir, entry ) ) )
	);

	const nodeModules = path.join( engineDir, 'node_modules' );
	if ( ! fs.existsSync( nodeModules ) ) {
		return;
	}
	const isCruft = ( file: string ): boolean =>
		/\.(map|d\.ts|d\.mts|d\.cts)$/.test( file ) || /\.md$/i.test( file );
	const walk = async ( dir: string ): Promise< void > => {
		const dirents = await fs.readdir( dir, { withFileTypes: true } );
		await Promise.all(
			dirents.map( async ( dirent ) => {
				const full = path.join( dir, dirent.name );
				if ( dirent.isDirectory() ) {
					await walk( full );
				} else if ( dirent.isFile() && isCruft( dirent.name ) ) {
					await fs.remove( full );
				}
			} )
		);
	};
	await walk( nodeModules );
}

async function prepareDataLiberation(): Promise< void > {
	if ( fs.existsSync( path.join( ENGINE_DIR, 'dist', 'mcp-server.js' ) ) ) {
		console.log( `[data-liberation] Already built at ${ ENGINE_DIR }. Delete it to rebuild.` );
		return;
	}

	console.log( `[data-liberation] Preparing engine (${ ENGINE_REF })…` );

	// Download + extract into a temp dir, then move the single repo dir into place.
	const tmpDir = path.join( os.tmpdir(), 'studio-data-liberation' );
	const zipPath = path.join( tmpDir, 'archive.zip' );
	const extractDir = path.join( tmpDir, 'extract' );
	await fs.remove( tmpDir );
	await fs.remove( ENGINE_DIR );

	try {
		await downloadFile( ENGINE_ARCHIVE_URL, zipPath );
		await extractZip( zipPath, extractDir );

		const entries = await fs.readdir( extractDir );
		const repoDir = entries.find( ( name ) => name.startsWith( 'data-liberation-agent-' ) );
		if ( ! repoDir ) {
			throw new Error(
				`Unexpected archive layout: no data-liberation-agent-* dir in ${ extractDir }`
			);
		}
		await fs.move( path.join( extractDir, repoDir ), ENGINE_DIR );
	} finally {
		await fs.remove( tmpDir );
	}

	// Install (incl. devDeps for the build) + compile to dist/, then drop devDeps.
	console.log( '[data-liberation] npm ci…' );
	run( 'npm', [ 'ci' ], ENGINE_DIR );
	console.log( '[data-liberation] npm run build…' );
	run( 'npm', [ 'run', 'build' ], ENGINE_DIR );
	console.log( '[data-liberation] mirroring runtime assets to dist/…' );
	await mirrorRuntimeAssets( ENGINE_DIR );
	console.log( '[data-liberation] pruning devDependencies…' );
	run( 'npm', [ 'prune', '--omit=dev' ], ENGINE_DIR );
	console.log( '[data-liberation] stripping non-runtime files…' );
	await pruneEngine( ENGINE_DIR );

	console.log( `[data-liberation] Done → ${ ENGINE_DIR }` );
}

prepareDataLiberation().catch( ( err ) => {
	console.error( err );
	process.exit( 1 );
} );
