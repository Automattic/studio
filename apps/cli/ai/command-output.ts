import { Logger, type ProgressCallback } from 'cli/logger';
import type { CommandOutput } from '@studio/agent/node/host';

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
): Promise< CommandOutput > {
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
