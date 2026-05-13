/**
 * The `studio migrate` command is a thin yargs wrapper around the Data
 * Liberation Agent (DLA) CLI. It is the non-agent, headless escape-hatch
 * path for users who want DLA's full Ink-rendered UI without Studio's
 * AI agent in the loop.
 *
 * Implementation summary:
 *
 * - Resolves DLA's CLI entry (`data-liberation/src/cli.ts`) and the `tsx`
 *   loader (`tsx/cli` — the public exports key, equivalent to
 *   `tsx/dist/cli.mjs` but spelled the way Node ESM resolution accepts).
 * - Spawns `process.execPath` with `[ tsx, dlaCli, <url>, ...args ]` and
 *   inherits the parent's stdio so DLA writes directly to the user's tty.
 * - Forwards SIGINT and SIGTERM to the child; exits with the child's
 *   exit code (or 128+signal for signal-terminated exits) so shell users
 *   can chain `studio migrate` like any other Unix command.
 * - Passes through only `LIBERATION_TOKEN` and `SHOPIFY_ADMIN_TOKEN` from
 *   the environment, plus DLA's existing env vars (`WP_APP_PASSWORD`,
 *   `NO_COLOR`, etc.). `STUDIO_WPCOM_TOKEN` is explicitly *not* forwarded
 *   because DLA's CLI never reads it — only DLA's MCP server does, and
 *   that path is not exercised here.
 *
 * Yargs-level flags are intentionally minimal — the URL is the only
 * positional, and `--output` / `--non-interactive` are surfaced for
 * discoverability. Any additional DLA flags can be passed verbatim
 * (yargs is configured non-strict so unknown args flow into the child).
 */

import { spawn, type ChildProcess } from 'child_process';
import { __ } from '@wordpress/i18n';
import { resolveDlaCliEntry, resolveTsxCli } from 'cli/commands/migrate/resolvers';
import { StudioArgv } from 'cli/types';

/**
 * The signals forwarded from the parent Studio CLI process down to the
 * spawned DLA child process. Listed explicitly so the parent installs
 * matching handlers up-front and removes them once the child exits.
 */
const FORWARDED_SIGNALS: NodeJS.Signals[] = [ 'SIGINT', 'SIGTERM' ];

/**
 * Environment variables forwarded from the parent into the DLA child.
 * `LIBERATION_TOKEN` and `SHOPIFY_ADMIN_TOKEN` are end-user-supplied
 * secrets that DLA reads directly. `WP_APP_PASSWORD` is DLA's import-path
 * secret; `NO_COLOR` and `CI` honor the user's terminal preferences.
 *
 * `STUDIO_WPCOM_TOKEN` is *not* forwarded — DLA's CLI does not read it
 * (only the MCP server does, via `@studio/dla/bridge`).
 */
const PASSTHROUGH_ENV_KEYS = [
	'LIBERATION_TOKEN',
	'SHOPIFY_ADMIN_TOKEN',
	'WP_APP_PASSWORD',
	'NO_COLOR',
	'CI',
] as const;

/**
 * Build the environment forwarded into the DLA child process. Starts
 * from `process.env` so DLA inherits PATH and other host-level state,
 * then prunes secrets that should not leak across.
 *
 * @returns The child environment with selectively-pruned variables.
 */
function buildChildEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	// Explicitly drop tokens that the DLA CLI does not consume; reduces
	// the surface area in case DLA changes upstream.
	delete env.STUDIO_WPCOM_TOKEN;
	// Re-assert the passthrough keys from the parent in case the spread
	// above missed them (it shouldn't, but this keeps intent explicit).
	for ( const key of PASSTHROUGH_ENV_KEYS ) {
		const value = process.env[ key ];
		if ( typeof value === 'string' && value.length > 0 ) {
			env[ key ] = value;
		}
	}
	return env;
}

/**
 * Translate a child-process exit (`code`, `signal`) into the parent's
 * exit code. Mirrors the standard shell convention: a normal exit
 * propagates its code; a signal-terminated exit becomes `128 + N` so
 * shell users can chain `studio migrate || echo failed`.
 *
 * @param code   - The child's numeric exit code, or `null` if it was killed by a signal.
 * @param signal - The signal that terminated the child, if any.
 * @returns The exit code the parent should adopt.
 */
function computeExitCode( code: number | null, signal: NodeJS.Signals | null ): number {
	if ( typeof code === 'number' ) {
		return code;
	}
	if ( signal ) {
		// `os.constants.signals` would be more correct but pulls in extra
		// surface — the two signals we care about (SIGINT=2, SIGTERM=15)
		// are mapped directly.
		const signalNumbers: Record< string, number > = {
			SIGHUP: 1,
			SIGINT: 2,
			SIGQUIT: 3,
			SIGTERM: 15,
		};
		const n = signalNumbers[ signal ];
		if ( typeof n === 'number' ) {
			return 128 + n;
		}
	}
	return 1;
}

/**
 * Spawn DLA's CLI and stream its output through to the user's terminal.
 *
 * @param url       - The site URL DLA should liberate (forwarded as the
 *                    bare-argument extract target).
 * @param extraArgs - Additional CLI flags passed verbatim after the URL
 *                    (e.g. `[ '--output', '/tmp/out', '--non-interactive' ]`).
 * @returns A promise that resolves when the child exits. The parent's
 *          `process.exitCode` is set to mirror the child's exit code.
 *
 * @example
 * await runCommand( 'https://example.com', [ '--output', './out', '--non-interactive' ] );
 */
export async function runCommand( url: string, extraArgs: string[] ): Promise< void > {
	let tsxCli: string;
	let dlaCli: string;
	try {
		tsxCli = resolveTsxCli();
		dlaCli = resolveDlaCliEntry();
	} catch ( error ) {
		const reason = error instanceof Error ? error.message : String( error );
		console.error(
			__(
				'studio migrate could not locate the Data Liberation Agent CLI. Reinstall Studio or run `npm install` to restore the dependency.'
			)
		);
		console.error( reason );
		process.exitCode = 1;
		return;
	}

	const args = [ tsxCli, dlaCli, url, ...extraArgs ];
	const child: ChildProcess = spawn( process.execPath, args, {
		stdio: 'inherit',
		env: buildChildEnv(),
	} );

	const forwardSignal = ( signal: NodeJS.Signals ) => {
		try {
			child.kill( signal );
		} catch {
			// Child may already have exited; nothing to do.
		}
	};
	const signalHandlers = new Map< NodeJS.Signals, ( signal: NodeJS.Signals ) => void >();
	for ( const signal of FORWARDED_SIGNALS ) {
		const handler = ( s: NodeJS.Signals ) => forwardSignal( s );
		signalHandlers.set( signal, handler );
		process.on( signal, handler );
	}

	try {
		await new Promise< void >( ( resolve ) => {
			let settled = false;
			const settle = () => {
				if ( settled ) {
					return;
				}
				settled = true;
				resolve();
			};
			child.on( 'error', ( error ) => {
				const reason = error instanceof Error ? error.message : String( error );
				console.error( __( 'studio migrate failed to spawn the Data Liberation Agent CLI.' ) );
				console.error( reason );
				process.exitCode = 1;
				settle();
			} );
			child.on( 'exit', ( code, signal ) => {
				process.exitCode = computeExitCode( code, signal );
				settle();
			} );
		} );
	} finally {
		for ( const [ signal, handler ] of signalHandlers ) {
			process.off( signal, handler );
		}
	}
}

/**
 * Register the `studio migrate <url>` command on the given yargs
 * instance. Surfaces a minimal set of flags; unknown args flow through
 * to DLA so future DLA flags work without a Studio-side release.
 *
 * @param yargs - The studio-typed yargs instance to register on.
 */
export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'migrate <url>',
		describe: __( 'Migrate a site from a closed platform using Data Liberation Agent' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'url', {
					type: 'string',
					demandOption: true,
					describe: __( 'URL of the site to migrate' ),
				} )
				.option( 'output', {
					type: 'string',
					describe: __( 'Output directory for extracted content (default: ./output)' ),
				} )
				.option( 'non-interactive', {
					type: 'boolean',
					describe: __( 'Skip the post-extraction import prompt' ),
				} )
				.strict( false );
		},
		handler: async ( argv ) => {
			const url = argv.url as string;
			const extraArgs: string[] = [];
			if ( typeof argv.output === 'string' && argv.output.length > 0 ) {
				extraArgs.push( '--output', argv.output );
			}
			if ( argv.nonInteractive ) {
				extraArgs.push( '--non-interactive' );
			}
			await runCommand( url, extraArgs );
		},
	} );
};
