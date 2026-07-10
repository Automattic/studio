#!/usr/bin/env tsx
/**
 * Creates a standalone Studio CLI bundle for terminal installs.
 *
 * The bundle is a tarball with the same layout the desktop app ships in its
 * resources directory — a real Node binary plus the CLI files — fronted by a
 * small `studio` launcher script:
 *
 *   bin/node[.exe]      Official Node.js binary for the target platform
 *   bin/studio[.cmd]    Launcher (the desktop app's studio-cli script, renamed)
 *   cli/                CLI bundle (main.mjs, node_modules, wp-files, …)
 *
 * The curl installers that consume this layout (`cli/` + `bin/`) live in wpcom
 * (served from public-api, branded as wordpress.studio/install.sh & install.ps1), not in
 * this repo — update them
 * in lockstep if this layout changes.
 *
 * Output:
 *   standalone-bundles/studio-cli-{platform}-{arch}.tgz
 *   standalone-bundles/studio-cli-{platform}-{arch}.tgz.sha256
 *
 * Prerequisites: Node.js >= 22, npm dependencies installed
 *
 * NOTE: The `cli:package:standalone` step mutates `apps/cli/node_modules`. If you need
 * a clean tree afterwards, run `npm ci` from the repo root to reset it.
 *
 * Native modules in cli/node_modules are built for the platform running this
 * script, so cross-platform bundles only get the right Node binary — CI must
 * build each platform's bundle on its own runner.
 *
 * Usage:
 *   npx tsx scripts/create-standalone-bundle.ts
 *   npx tsx scripts/create-standalone-bundle.ts darwin arm64
 *   npx tsx scripts/create-standalone-bundle.ts win32 x64
 */

import { execSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { downloadNodeBinary } from './download-node-binary';

const repoRoot = path.join( __dirname, '..' );

const platformArg = process.argv[ 2 ] || process.platform;
const archArg = process.argv[ 3 ] || process.arch;

const supportedPlatforms = [ 'darwin', 'linux', 'win32' ];
const supportedArchs = [ 'x64', 'arm64' ];

if ( ! supportedPlatforms.includes( platformArg ) ) {
	console.error(
		`Unsupported platform: ${ platformArg }. Supported: ${ supportedPlatforms.join( ', ' ) }`
	);
	process.exit( 1 );
}

if ( ! supportedArchs.includes( archArg ) ) {
	console.error(
		`Unsupported architecture: ${ archArg }. Supported: ${ supportedArchs.join( ', ' ) }`
	);
	process.exit( 1 );
}

const isWindows = platformArg === 'win32';
const bundleName = `studio-cli-${ platformArg }-${ archArg }.tgz`;
const outputDir = path.join( repoRoot, 'standalone-bundles' );
const stagingDir = path.join( outputDir, `staging-${ platformArg }-${ archArg }` );
const cliDistDir = path.join( repoRoot, 'apps', 'cli', 'dist', 'cli' );

function run( cmd: string, cwd?: string ): void {
	execSync( cmd, { cwd: cwd ?? repoRoot, stdio: 'inherit' } );
}

function sha256( file: string ): string {
	return createHash( 'sha256' ).update( fs.readFileSync( file ) ).digest( 'hex' );
}

// Create a gzipped tarball by streaming tar's stdout to a file. Keeping the
// archive path out of tar's argv avoids GNU tar (Git Bash / Buildkite Windows)
// interpreting "C:" as a remote host ("Cannot connect to C: resolve failed").
// BSD tar (macOS, Windows 10+) handles it either way.
function createTarball( archivePath: string, cwd: string, extraArgs: string[] ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( 'tar', [ '-cz', ...extraArgs, '.' ], {
			cwd,
			stdio: [ 'ignore', 'pipe', 'inherit' ],
		} );
		const out = fs.createWriteStream( archivePath );
		child.stdout.pipe( out );

		// Resolve only once tar has exited 0 AND the write stream has flushed and
		// closed. Resolving on tar's exit alone can leave a large archive still
		// buffering, producing a truncated file (and a mismatched checksum).
		let tarExitCode: number | null = null;
		let tarExited = false;
		let outClosed = false;
		let settled = false;

		const fail = ( err: Error ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			reject( err );
		};

		const maybeResolve = () => {
			if ( settled || ! tarExited || ! outClosed ) {
				return;
			}
			if ( tarExitCode !== 0 ) {
				fail( new Error( `tar exited with code ${ tarExitCode }` ) );
				return;
			}
			settled = true;
			resolve();
		};

		out.on( 'error', fail );
		child.on( 'error', fail );
		child.on( 'close', ( code ) => {
			tarExited = true;
			tarExitCode = code;
			maybeResolve();
		} );
		out.on( 'close', () => {
			outClosed = true;
			maybeResolve();
		} );
	} );
}

async function main(): Promise< void > {
	console.log( `==> Building standalone bundle: ${ bundleName }\n` );

	// Step 1: Build CLI (dist/cli with bundled node_modules). Same as the desktop-embedded
	// prod build, but `package:standalone` stamps `__IS_PACKAGED_FOR_STANDALONE__` so the
	// curl-installed CLI identifies itself at runtime (update notifier + launch stats).
	console.log( '==> Step 1/4: Building CLI package...' );
	// install:bundle can run twice per CI job (the desktop make's forge hook runs
	// it first). npm's --install-links re-resolves the changed data-liberation
	// file: dep from the registry (E404) when reinstalling over that tree, so
	// start from a clean node_modules, same as forge.config.ts does.
	fs.rmSync( path.join( repoRoot, 'apps', 'cli', 'node_modules' ), {
		recursive: true,
		force: true,
	} );
	run( 'npm run cli:package:standalone' );

	// Step 2: Assemble the bundle layout in a staging dir
	console.log( '\n==> Step 2/4: Assembling bundle...' );
	fs.rmSync( stagingDir, { recursive: true, force: true } );
	fs.mkdirSync( path.join( stagingDir, 'bin' ), { recursive: true } );

	fs.cpSync( cliDistDir, path.join( stagingDir, 'cli' ), { recursive: true } );

	// Reuse the desktop app's CLI launcher scripts — same bin/node + cli/main.mjs
	// layout — so there's a single launcher implementation. The standalone
	// install ships it under the `studio` name users invoke.
	const launcherSource = isWindows ? 'studio-cli.bat' : 'studio-cli.sh';
	const launcherName = isWindows ? 'studio.cmd' : 'studio';
	const launcherPath = path.join( stagingDir, 'bin', launcherName );
	fs.copyFileSync( path.join( repoRoot, 'apps', 'studio', 'bin', launcherSource ), launcherPath );
	if ( ! isWindows ) {
		fs.chmodSync( launcherPath, 0o755 );
	}

	// Step 3: Download the Node binary for the target platform into bin/
	console.log( `\n==> Step 3/4: Downloading Node.js binary for ${ platformArg }-${ archArg }...` );
	await downloadNodeBinary( platformArg, archArg, path.join( stagingDir, 'bin' ) );

	// Step 4: Create the tarball + checksum
	console.log( '\n==> Step 4/4: Creating tarball...' );
	fs.mkdirSync( outputDir, { recursive: true } );
	const outputPath = path.join( outputDir, bundleName );
	fs.rmSync( outputPath, { force: true } );

	// Same node_modules prunes the desktop packaging applies: browser caches and
	// AI provider SDKs that pi-ai loads lazily but Studio never uses. @mistralai's
	// ~200-char generated filenames can also exceed Windows' 260-char path limit
	// on extraction. Patterns are unanchored, so they match at any nesting depth.
	await createTarball( outputPath, stagingDir, [
		'--exclude=.cache',
		'--exclude=playwright/browsers',
		'--exclude=playwright-core/browsers',
		'--exclude=@mistralai',
		'--exclude=@aws-sdk',
		'--exclude=@aws-crypto',
		'--exclude=@smithy',
		'--exclude=@google/genai',
	] );

	// Emit a SHA-256 checksum file alongside the tarball so the curl installers
	// can verify the download before installing it.
	const bundleSha = sha256( outputPath );
	const checksumPath = `${ outputPath }.sha256`;
	fs.writeFileSync( checksumPath, `${ bundleSha }  ${ bundleName }\n` );

	fs.rmSync( stagingDir, { recursive: true, force: true } );

	const size = ( fs.statSync( outputPath ).size / 1024 / 1024 ).toFixed( 1 );
	console.log( `\n==> Done! Bundle: ${ outputPath } (${ size } MB)` );
	console.log( `    SHA-256:  ${ bundleSha }` );
	console.log( `    Checksum: ${ checksumPath }` );
}

main().catch( ( error ) => {
	console.error( 'Error:', error.message );
	process.exit( 1 );
} );
