import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { writeStudioMuPluginsForNativePhpRuntime } from '@studio/common/lib/mu-plugins';
import { validateNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import { SupportedPHPVersion } from '@studio/common/types/php-versions';
import {
	getPhpBinaryPath,
	getSqliteCommandPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';
import { getDefaultPhpArgs } from './native-php';
import type { SiteData } from 'cli/lib/cli-config/core';

const PLAYGROUND_RUNTIME_UNAVAILABLE_ERROR =
	'The Playground (PHP WASM) WP-CLI runtime is not available in this experimental build. ' +
	'Recreate the site with the native-php runtime or set STUDIO_RUNTIME=native-php.';

/**
 * Runtime-agnostic WP-CLI invocation result. Both the native PHP runtime and
 * the Playground runtime produce instances of this class, so callers stay
 * decoupled from Playground's `StreamedPHPResponse`.
 *
 * The text getters consume the same underlying stream as `stdout`/`stderr` —
 * use one or the other, not both.
 */
export class WpCliResponse {
	readonly stdout: Readable;
	readonly stderr: Readable;
	readonly exitCode: Promise< number >;
	#stdoutText?: Promise< string >;
	#stderrText?: Promise< string >;

	constructor( stdout: Readable, stderr: Readable, exitCode: Promise< number > ) {
		this.stdout = stdout;
		this.stderr = stderr;
		this.exitCode = exitCode;
	}

	get stdoutText(): Promise< string > {
		this.#stdoutText ??= text( this.stdout );
		return this.#stdoutText;
	}

	get stderrText(): Promise< string > {
		this.#stderrText ??= text( this.stderr );
		return this.#stderrText;
	}
}

type RunWpCliCommandOptions = {
	siteUrl?: string;
	requireSqliteCliCommand?: boolean;
	phpVersion?: SupportedPHPVersion;
};

type DisposableWpCliResponse = Disposable & {
	response: WpCliResponse;
};

function applyWpCliCommandOptions( args: string[], options: RunWpCliCommandOptions ): string[] {
	let normalizedArgs = args.slice();

	if ( options.requireSqliteCliCommand ) {
		const sqliteCommandPath = path.join( getSqliteCommandPath(), 'command.php' );
		const requireArg = `--require=${ sqliteCommandPath }`;

		if ( ! normalizedArgs.includes( requireArg ) ) {
			normalizedArgs = [ ...normalizedArgs, requireArg ];
		}
	}

	return normalizedArgs;
}

async function ensureChildSpawned( child: ChildProcess ): Promise< void > {
	await new Promise< void >( ( resolve, reject ) => {
		const onSpawn = () => {
			child.off( 'error', onError );
			resolve();
		};
		const onError = ( error: Error ) => {
			child.off( 'spawn', onSpawn );
			reject( error );
		};

		child.once( 'spawn', onSpawn );
		child.once( 'error', onError );
	} );
}

async function runNativeWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	const nativeArgs = applyWpCliCommandOptions( args, options );
	const phpVersion = validateNativePhpVersion( options.phpVersion ?? DEFAULT_PHP_VERSION );
	await writeStudioMuPluginsForNativePhpRuntime( site.path, site.isWpAutoUpdating );
	// Don't apply open_basedir or disable_functions to the WP-CLI process
	const defaultArgs = getDefaultPhpArgs( phpVersion );
	const child = spawn(
		getPhpBinaryPath( phpVersion ),
		[ ...defaultArgs, getWpCliPharPath(), `--path=${ site.path }`, ...nativeArgs ],
		{
			cwd: site.path,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);

	await ensureChildSpawned( child );

	const exitCode = new Promise< number >( ( resolve, reject ) => {
		child.once( 'error', ( error: Error ) => reject( error ) );
		child.once( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );

	return {
		response: new WpCliResponse( child.stdout, child.stderr, exitCode ),
		[ Symbol.dispose ]() {
			if ( child.exitCode === null && child.signalCode === null && ! child.killed ) {
				child.kill( 'SIGKILL' );
			}
		},
	};
}

// Run a WP-CLI command. Only the native PHP runtime is supported in this
// experimental build; sites configured with the Playground runtime throw
// before any WP-CLI work happens.
export async function runWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	if ( site.runtime !== 'native-php' ) {
		throw new Error( PLAYGROUND_RUNTIME_UNAVAILABLE_ERROR );
	}

	return runNativeWpCliCommand( site, args, options );
}

async function runNativeGlobalWpCliCommand( args: string[] ): Promise< DisposableWpCliResponse > {
	const phpVersion = validateNativePhpVersion( DEFAULT_PHP_VERSION );
	// Don't apply open_basedir or disable_functions to the WP-CLI process
	const defaultArgs = getDefaultPhpArgs( phpVersion );
	const child = spawn(
		getPhpBinaryPath( phpVersion ),
		[ ...defaultArgs, getWpCliPharPath(), ...args ],
		{ stdio: [ 'ignore', 'pipe', 'pipe' ] }
	);

	await ensureChildSpawned( child );

	const exitCode = new Promise< number >( ( resolve, reject ) => {
		child.once( 'error', ( error: Error ) => reject( error ) );
		child.once( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );

	return {
		response: new WpCliResponse( child.stdout, child.stderr, exitCode ),
		[ Symbol.dispose ]() {
			if ( child.exitCode === null && child.signalCode === null && ! child.killed ) {
				child.kill( 'SIGKILL' );
			}
		},
	};
}

type RunGlobalWpCliCommandOptions = {
	runtime?: 'wasm' | 'native-php';
};

/**
 * Run a global WP-CLI command without requiring a site. Only the native PHP
 * runtime is supported in this experimental build; callers that opt into the
 * Playground (`runtime: 'wasm'`) runtime get an explicit error.
 */
export async function runGlobalWpCliCommand(
	args: string[],
	options: RunGlobalWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	if ( options.runtime && options.runtime !== 'native-php' ) {
		throw new Error( PLAYGROUND_RUNTIME_UNAVAILABLE_ERROR );
	}

	return runNativeGlobalWpCliCommand( args );
}
