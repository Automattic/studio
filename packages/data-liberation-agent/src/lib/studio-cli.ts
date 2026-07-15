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
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify( execFile );

let cached: { file: string; prefix: string[] } | null = null;

/** Resolve how to spawn the Studio CLI on this platform (memoized). */
function studioCommand(): { file: string; prefix: string[] } {
	if ( cached ) return cached;
	if ( process.platform !== 'win32' ) {
		return ( cached = { file: 'studio', prefix: [] } );
	}
	// The npm global layout is `<dir>/studio.cmd` + `<dir>/node_modules/wp-studio`;
	// the package's bin field names the JS entry the shim wraps.
	for ( const dir of ( process.env.PATH ?? '' ).split( delimiter ) ) {
		if ( ! dir || ! existsSync( join( dir, 'studio.cmd' ) ) ) continue;
		try {
			const pkgDir = join( dir, 'node_modules', 'wp-studio' );
			const { bin } = JSON.parse( readFileSync( join( pkgDir, 'package.json' ), 'utf8' ) ) as {
				bin?: string | { studio?: string };
			};
			const entry = join( pkgDir, typeof bin === 'string' ? bin : bin?.studio ?? '' );
			if ( existsSync( entry ) ) {
				return ( cached = { file: process.execPath, prefix: [ entry ] } );
			}
		} catch {
			// No readable wp-studio package next to this shim — keep scanning PATH.
		}
	}
	throw new Error( 'Studio CLI not found on PATH. Install it with `npm i -g wp-studio`.' );
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
