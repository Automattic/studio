import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'path';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { Logger, type ProgressCallback } from 'cli/logger';
import type { AnyStudioAgentTool } from './define-tool';

async function findSiteByName( name: string ): Promise< SiteData | undefined > {
	const config = await readCliConfig();
	const sites = config.sites.filter( ( site ) => site.name.toLowerCase() === name.toLowerCase() );
	if ( sites.length > 1 ) {
		const paths = sites.map( ( site ) => site.path ).join( ', ' );
		throw new Error(
			`${ sites.length } sites are named "${ name }". Pass the full path of the one you mean: ${ paths }`
		);
	}
	return sites[ 0 ];
}

export async function resolveSite( nameOrPath: string ): Promise< SiteData > {
	const siteByName = await findSiteByName( nameOrPath );
	if ( siteByName ) {
		return siteByName;
	}

	// Also try matching by the last folder segment of the site path,
	// since the agent may pass just the folder name instead of the full path.
	if ( ! path.isAbsolute( nameOrPath ) ) {
		const config = await readCliConfig();
		const siteByFolder = config.sites.find( ( site ) => path.basename( site.path ) === nameOrPath );
		if ( siteByFolder ) {
			return siteByFolder;
		}
	}

	return getSiteByFolder( nameOrPath );
}

/** The local site a call names, by the tool's site argument; undefined when it names none. */
export async function siteOfCall( tool: object, args: unknown ): Promise< SiteData | undefined > {
	const { siteParam = 'nameOrPath' } = tool as Pick< AnyStudioAgentTool, 'siteParam' >;
	const named = ( args as Record< string, unknown > | undefined )?.[ siteParam ];
	return typeof named === 'string' ? resolveSite( named ).catch( () => undefined ) : undefined;
}

// Callers connect to the daemon first, like runWpCliCommand requires.
export async function runWpCli( site: SiteData, args: string[] ): Promise< string > {
	await using command = await runWpCliCommand( site, args );
	const exitCode = await command.response.exitCode;
	const stdout = await command.response.stdoutText;
	if ( exitCode !== 0 ) {
		const detail = ( ( await command.response.stderrText ) || stdout ).trim();
		throw new Error( `WP-CLI exited with code ${ exitCode }${ detail ? `: ${ detail }` : '' }` );
	}
	return stdout;
}

export function textResult( text: string ) {
	return {
		content: [ { type: 'text' as const, text } ],
	};
}

// What a command prints goes to the capture of the tool call that runs it.
// Tool calls run in parallel, so the capture is the call's own: swapping
// console.log for each call hands an overlapping call's lines to the other.
const captures = new AsyncLocalStorage< string[] >();
const routers = new Set< unknown >();
// console.table renders the table and prints it with console.log.
function routeConsole() {
	if ( routers.has( console.log ) ) {
		return;
	}
	const original = console.log;
	const router = ( ...args: unknown[] ) => {
		const lines = captures.getStore();
		if ( lines ) {
			lines.push( args.map( String ).join( ' ' ) );
		} else {
			original.apply( console, args );
		}
	};
	routers.add( router );
	console.log = router;
}

// Site list / status print JSON via console.log; capture it for tool output.
export async function captureConsoleOutput( fn: () => Promise< void > ): Promise< string > {
	routeConsole();
	const lines: string[] = [];
	await captures.run( lines, fn );
	return lines.join( '\n' ).trim();
}

export async function captureCommandOutput(
	fn: ( logger: Logger< string > ) => Promise< void >,
	onProgress?: ProgressCallback
): Promise< {
	consoleOutput: string;
	progressOutput: string;
	exitCode: number | undefined;
} > {
	const progressMessages: string[] = [];
	let thrownError: unknown;
	const previousExitCode = process.exitCode;
	process.exitCode = undefined;
	const logger = new Logger< string >( {
		onProgress: ( message, update ) => {
			// `update: true` is a rolling refresh of the same line (e.g. "(74%)" →
			// "(75%)"); coalesce so progressOutput only keeps the latest value.
			if ( update && progressMessages.length > 0 ) {
				progressMessages[ progressMessages.length - 1 ] = message;
			} else {
				progressMessages.push( message );
			}
			onProgress?.( message, update );
		},
	} );

	const consoleOutput = await captureConsoleOutput( async () => {
		try {
			await fn( logger );
		} catch ( error ) {
			thrownError = error;
		}
	} );

	const exitCode = process.exitCode;
	process.exitCode = previousExitCode;

	if ( thrownError ) {
		throw thrownError;
	}

	return {
		consoleOutput,
		progressOutput: progressMessages.join( '\n' ),
		exitCode,
	};
}
