import path from 'path';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getProgressCallback, setProgressCallback } from 'cli/logger';

async function findSiteByName( name: string ): Promise< SiteData | undefined > {
	const config = await readCliConfig();
	return config.sites.find( ( site ) => site.name.toLowerCase() === name.toLowerCase() );
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

export async function captureCommandOutput( fn: () => Promise< void > ): Promise< {
	consoleOutput: string;
	progressOutput: string;
	exitCode: number | undefined;
} > {
	let consoleOutput = '';
	const progressMessages: string[] = [];
	let thrownError: unknown;
	const originalConsoleLog = console.log;
	const originalConsoleTable = console.table;
	const previousCallback = getProgressCallback();
	const previousExitCode = process.exitCode;

	console.log = ( ...args: unknown[] ) => {
		consoleOutput += args.map( String ).join( ' ' ) + '\n';
	};
	console.table = ( ...args: unknown[] ) => {
		consoleOutput += args.map( String ).join( ' ' ) + '\n';
	};
	process.exitCode = undefined;
	setProgressCallback( ( message, update ) => {
		// `update: true` is a rolling refresh of the same line (e.g. "(74%)" →
		// "(75%)"); coalesce so progressOutput only keeps the latest value.
		if ( update && progressMessages.length > 0 ) {
			progressMessages[ progressMessages.length - 1 ] = message;
		} else {
			progressMessages.push( message );
		}
		previousCallback?.( message, update );
	} );

	try {
		await fn();
	} catch ( error ) {
		thrownError = error;
	} finally {
		console.log = originalConsoleLog;
		console.table = originalConsoleTable;
		setProgressCallback( previousCallback );
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
