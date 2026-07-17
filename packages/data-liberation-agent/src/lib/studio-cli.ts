/**
 * Cross-platform Studio CLI invocation (STU-2020).
 *
 * Every spawn of the Studio CLI must go through this module instead of
 * `execFile*('studio', ...)`. The global `studio` command is the wp-studio npm
 * package's JS entry (`dist/cli/main.mjs`). On POSIX the bin is a symlink to
 * that file and spawns directly. On Windows npm wraps it in a `studio.cmd`
 * batch shim, which Node >= 20.12 refuses to spawn without `shell: true`
 * (EINVAL, the CVE-2024-27980 hardening) — and `shell: true` is not an option
 * here because call sites pass `wp eval` PHP payloads and whole post bodies
 * that cmd.exe re-parsing would mangle. Instead we run the same JS entry the
 * shim wraps with the current Node binary, so argv passes through byte-exact,
 * no shell involved.
 */
import {
	execFile,
	execFileSync,
	type ChildProcess,
	type ExecFileOptions,
	type ExecFileSyncOptions,
} from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify( execFile );

let cached: { file: string; prefix: string[] } | null = null;

/**
 * Launcher layout (standalone bundle and the desktop app's `resources/bin/`):
 * a bundled `node.exe` beside the shim, entry at `../cli/main.mjs` or
 * `../dist/cli/main.mjs`. Mirrors `apps/studio/bin/studio-cli.bat`.
 */
function resolveLauncherLayout( dir: string ): { file: string; prefix: string[] } | null {
	const bundledNode = join( dir, 'node.exe' );
	const node = existsSync( bundledNode ) ? bundledNode : process.execPath;
	for ( const entry of [
		join( dir, '..', 'cli', 'main.mjs' ),
		join( dir, '..', 'dist', 'cli', 'main.mjs' ),
	] ) {
		if ( existsSync( entry ) ) {
			return { file: node, prefix: [ '--experimental-wasm-jspi', entry ] };
		}
	}
	return null;
}

/** Resolve how to spawn the Studio CLI on this platform (memoized). */
function studioCommand(): { file: string; prefix: string[] } {
	if ( cached ) return cached;
	if ( process.platform !== 'win32' ) {
		return ( cached = { file: 'studio', prefix: [] } );
	}
	for ( const dir of ( process.env.PATH ?? '' ).split( delimiter ) ) {
		if ( ! dir ) continue;
		if ( existsSync( join( dir, 'studio.cmd' ) ) ) {
			// npm global layout: studio.cmd + node_modules/wp-studio; the package's
			// bin field names the JS entry the shim wraps.
			try {
				const pkgDir = join( dir, 'node_modules', 'wp-studio' );
				const { bin } = JSON.parse( readFileSync( join( pkgDir, 'package.json' ), 'utf8' ) ) as {
					bin?: string | { studio?: string };
				};
				const rel = typeof bin === 'string' ? bin : bin?.studio;
				if ( rel && existsSync( join( pkgDir, rel ) ) ) {
					return ( cached = { file: process.execPath, prefix: [ join( pkgDir, rel ) ] } );
				}
			} catch {
				// No readable wp-studio package beside this shim — try the launcher layout.
			}
			// Standalone layout: node.exe + entry beside the shim.
			const launcher = resolveLauncherLayout( dir );
			if ( launcher ) return ( cached = launcher );
		}
		// Desktop app layout: a studio.bat one-liner (`"%~dp0\<rel>" %*`) forwarding
		// to the versioned studio-cli.bat; see windows-installation-manager.ts.
		const proxy = join( dir, 'studio.bat' );
		if ( existsSync( proxy ) ) {
			try {
				const target = readFileSync( proxy, 'utf8' ).match( /"%~dp0\\?([^"]+)"\s+%\*/ )?.[ 1 ];
				const launcher = target && resolveLauncherLayout( dirname( join( dir, target ) ) );
				if ( launcher ) return ( cached = launcher );
			} catch {
				// Unreadable proxy — keep scanning PATH.
			}
		}
	}
	throw new Error(
		'Studio CLI not found on PATH. Enable the `studio` command from the Studio app settings, or install it with `npm i -g wp-studio`.'
	);
}

/**
 * `execFileSync('studio', args, opts)`, cross-platform. Output is utf8 text
 * (empty when the caller pipes stdout away, e.g. `stdio: 'ignore'`).
 */
export function studioExecFileSync( args: string[], opts: ExecFileSyncOptions = {} ): string {
	const { file, prefix } = studioCommand();
	return execFileSync( file, [ ...prefix, ...args ], { ...opts, encoding: 'utf8' } ) ?? '';
}

/** Promisified `execFile('studio', args, opts)`, cross-platform. */
export function studioExecFileAsync(
	args: string[],
	opts: ExecFileOptions = {}
): Promise< { stdout: string; stderr: string } > {
	const { file, prefix } = studioCommand();
	return execFileAsync( file, [ ...prefix, ...args ], opts ) as Promise< {
		stdout: string;
		stderr: string;
	} >;
}

/**
 * `execFile('studio', args, opts)`, cross-platform — returns the ChildProcess,
 * for callers that need stdin/stream access (e.g. answering `studio site
 * delete`'s prompt).
 */
export function studioExecFile( args: string[], opts: ExecFileOptions = {} ): ChildProcess {
	const { file, prefix } = studioCommand();
	return execFile( file, [ ...prefix, ...args ], opts, undefined );
}
