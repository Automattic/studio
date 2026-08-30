import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ensurePlaywrightChromiumInstalled } from 'cli/ai/browser-utils';

type DataLiberationCliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type RunDataLiberationCli = (
	args: string[],
	onProgress?: ( message: string ) => void
) => Promise< DataLiberationCliResult >;

type LiberateWebsiteOptions = {
	onProgress?: ( message: string ) => void;
	runCli?: RunDataLiberationCli;
};

export function getDataLiberationCliPath(): string {
	return path.join( import.meta.dirname, 'data-liberation-agent', 'dist', 'cli.bundle.mjs' );
}

function appendBounded( current: string, chunk: string ): string {
	return ( current + chunk ).slice( -64 * 1024 );
}

async function runDataLiberationCli(
	args: string[],
	onProgress?: ( message: string ) => void
): Promise< DataLiberationCliResult > {
	const { chromium } = await import( 'playwright' );
	const browserProblem = await ensurePlaywrightChromiumInstalled( chromium );
	if ( browserProblem ) {
		throw new Error( browserProblem );
	}

	const cliPath = getDataLiberationCliPath();
	if ( ! fs.existsSync( cliPath ) ) {
		throw new Error(
			'Data Liberation CLI is not compiled. Run `npm -w data-liberation run build:mcp-bundle` and try again.'
		);
	}

	return new Promise( ( resolve, reject ) => {
		const child = spawn( process.execPath, [ cliPath, ...args ], {
			cwd: path.dirname( path.dirname( cliPath ) ),
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		} );
		let stdout = '';
		let stderr = '';
		let pendingProgress = '';

		child.stdout.setEncoding( 'utf8' );
		child.stderr.setEncoding( 'utf8' );
		child.stdout.on( 'data', ( chunk: string ) => {
			stdout = appendBounded( stdout, chunk );
		} );
		child.stderr.on( 'data', ( chunk: string ) => {
			stderr = appendBounded( stderr, chunk );
			pendingProgress += chunk;
			const lines = pendingProgress.split( /\r?\n/ );
			pendingProgress = lines.pop() ?? '';
			for ( const line of lines ) {
				if ( line.trim() ) {
					onProgress?.( line.trim() );
				}
			}
		} );
		child.once( 'error', reject );
		child.once( 'close', ( code ) => {
			if ( pendingProgress.trim() ) {
				onProgress?.( pendingProgress.trim() );
			}
			resolve( { exitCode: code ?? 1, stdout, stderr } );
		} );
	} );
}

export async function liberateWebsite(
	url: string,
	outputBase: string,
	options: LiberateWebsiteOptions = {}
): Promise< string > {
	const parsed = new URL( url );
	if ( ! [ 'http:', 'https:' ].includes( parsed.protocol ) ) {
		throw new Error( 'Source URLs must use HTTP or HTTPS.' );
	}

	const resolvedOutputBase = path.resolve( outputBase );
	fs.mkdirSync( resolvedOutputBase, { recursive: true } );
	const result = await ( options.runCli ?? runDataLiberationCli )(
		[ parsed.href, '--output', resolvedOutputBase, '--resume' ],
		options.onProgress
	);
	if ( result.exitCode !== 0 ) {
		throw new Error( result.stderr.trim() || result.stdout.trim() || 'Data Liberation failed.' );
	}

	const siteLine = result.stdout
		.trim()
		.split( /\r?\n/ )
		.reverse()
		.find( ( line ) => line.startsWith( 'Site: ' ) );
	if ( ! siteLine ) {
		throw new Error( 'Data Liberation completed without reporting a website directory.' );
	}

	const websiteDir = path.resolve( siteLine.slice( 'Site: '.length ).trim() );
	const relativeWebsiteDir = path.relative( resolvedOutputBase, websiteDir );
	if (
		relativeWebsiteDir === '..' ||
		relativeWebsiteDir.startsWith( `..${ path.sep }` ) ||
		! fs.existsSync( websiteDir ) ||
		! fs.statSync( websiteDir ).isDirectory()
	) {
		throw new Error( 'Data Liberation reported an invalid website directory.' );
	}

	return websiteDir;
}
