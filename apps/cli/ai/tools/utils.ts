import path from 'path';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { Logger, type ProgressCallback } from 'cli/logger';

function onlyMatch( sites: SiteData[], nameOrPath: string ): SiteData | undefined {
	if ( sites.length > 1 ) {
		throw new Error(
			`${
				sites.length
			} sites match "${ nameOrPath }". Pass the full path of the one you mean: ${ sites
				.map( ( site ) => site.path )
				.join( ', ' ) }`
		);
	}
	return sites[ 0 ];
}

export async function resolveSite( nameOrPath: string ): Promise< SiteData > {
	if ( path.isAbsolute( nameOrPath ) ) {
		return getSiteByFolder( nameOrPath );
	}

	// The agent may also pass the last folder segment of the site path.
	const { sites } = await readCliConfig();
	return (
		onlyMatch(
			sites.filter( ( site ) => site.name.toLowerCase() === nameOrPath.toLowerCase() ),
			nameOrPath
		) ??
		onlyMatch(
			sites.filter( ( site ) => path.basename( site.path ) === nameOrPath ),
			nameOrPath
		) ??
		getSiteByFolder( nameOrPath )
	);
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

// Site list / status print JSON via console.log; capture it for tool output.
export async function captureConsoleOutput( fn: () => Promise< void > ): Promise< string > {
	let captured = '';
	const origLog = console.log;
	const origTable = console.table;
	console.log = ( ...args: unknown[] ) => {
		captured += args.map( String ).join( ' ' ) + '\n';
	};
	console.table = ( ...args: unknown[] ) => {
		captured += args.map( String ).join( ' ' ) + '\n';
	};
	try {
		await fn();
	} finally {
		console.log = origLog;
		console.table = origTable;
	}
	return captured.trim();
}

export async function captureCommandOutput(
	fn: ( logger: Logger< string > ) => Promise< void >,
	onProgress?: ProgressCallback
): Promise< {
	consoleOutput: string;
	progressOutput: string;
	exitCode: number | undefined;
} > {
	let consoleOutput = '';
	const progressMessages: string[] = [];
	let thrownError: unknown;
	const originalConsoleLog = console.log;
	const originalConsoleTable = console.table;
	const previousExitCode = process.exitCode;

	console.log = ( ...args: unknown[] ) => {
		consoleOutput += args.map( String ).join( ' ' ) + '\n';
	};
	console.table = ( ...args: unknown[] ) => {
		consoleOutput += args.map( String ).join( ' ' ) + '\n';
	};
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

	try {
		await fn( logger );
	} catch ( error ) {
		thrownError = error;
	} finally {
		console.log = originalConsoleLog;
		console.table = originalConsoleTable;
	}

	const exitCode = process.exitCode;
	process.exitCode = previousExitCode;

	if ( thrownError ) {
		throw thrownError;
	}

	return {
		consoleOutput: consoleOutput.trim(),
		progressOutput: progressMessages.join( '\n' ),
		exitCode,
	};
}
