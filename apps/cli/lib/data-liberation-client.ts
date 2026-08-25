import fs, { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { __, sprintf } from '@wordpress/i18n';
import { ensurePlaywrightChromiumInstalled } from 'cli/ai/browser-utils';
import { LoggerError } from 'cli/logger';

const ENGINE_CALL_TIMEOUT_MS = 600_000;

export interface CaptureProgress {
	phase: 'discovering' | 'capturing' | 'finalizing' | 'complete';
	current?: number;
	total?: number;
	url?: string;
	elapsedMs?: number;
	phaseElapsedMs?: number;
}

export interface CaptureResult {
	artifactPath: string;
	outputDir: string;
	provenance: Record< string, unknown >;
}

interface CaptureOptions {
	resume?: boolean;
	onProgress?: ( progress: CaptureProgress ) => void;
	capture?: typeof callDataLiberationCapture;
}

export function captureProgressMessage( progress: CaptureProgress ): string {
	const elapsedSeconds = Math.floor( ( progress.elapsedMs ?? 0 ) / 1000 );
	if ( progress.phase === 'discovering' )
		return sprintf( __( 'Capture: discovering website routes… %d sec elapsed' ), elapsedSeconds );
	if ( progress.phase === 'finalizing' )
		return sprintf( __( 'Capture: finalizing website artifact… %d sec elapsed' ), elapsedSeconds );
	if ( progress.phase === 'complete' )
		return sprintf( __( 'Capture complete in %d sec' ), elapsedSeconds );
	if ( typeof progress.current === 'number' && typeof progress.total === 'number' ) {
		return sprintf(
			/* translators: 1: completed route count, 2: total route count, 3: elapsed seconds */
			__( 'Capture: route %1$d of %2$d… %3$d sec elapsed' ),
			progress.current,
			progress.total,
			elapsedSeconds
		);
	}
	return sprintf( __( 'Capture: capturing website routes… %d sec elapsed' ), elapsedSeconds );
}

export function getDataLiberationEngineDir(): string {
	return path.join( import.meta.dirname, 'data-liberation-agent' );
}

async function connectClient( engineDir: string ): Promise< Client > {
	const bundle = path.join( engineDir, 'dist', 'mcp-server.bundle.mjs' );
	if ( ! existsSync( bundle ) ) {
		throw new Error(
			'Data Liberation engine is not compiled. Run `npm run cli:build` and try again.'
		);
	}

	const transport = new StdioClientTransport( {
		command: process.execPath,
		args: [ bundle ],
		cwd: engineDir,
		stderr: 'pipe',
	} );
	const client = new Client( { name: 'studio-cli', version: '1.0.0' }, { capabilities: {} } );
	await client.connect( transport );
	return client;
}

export async function listDataLiberationTools(
	engineDir = getDataLiberationEngineDir()
): Promise< unknown[] > {
	const client = await connectClient( engineDir );
	try {
		return ( await client.listTools() ).tools;
	} finally {
		await client.close();
	}
}

export async function callDataLiberationTool(
	tool: string,
	args: Record< string, unknown >,
	engineDir = getDataLiberationEngineDir()
): Promise< unknown > {
	if ( tool === 'liberate_capture' ) {
		const { chromium } = await import( 'playwright' );
		const browserProblem = await ensurePlaywrightChromiumInstalled( chromium );
		if ( browserProblem ) {
			throw new Error( browserProblem );
		}
	}

	const client = await connectClient( engineDir );
	try {
		const result = await client.callTool( { name: tool, arguments: args }, undefined, {
			timeout: ENGINE_CALL_TIMEOUT_MS,
			resetTimeoutOnProgress: true,
		} );
		const text = Array.isArray( result.content )
			? result.content
					.map( ( part ) =>
						part && typeof part === 'object' && 'text' in part ? String( part.text ) : ''
					)
					.join( '\n' )
					.trim()
			: '';
		if ( result.isError ) {
			throw new Error( text || `Data Liberation tool ${ tool } failed.` );
		}
		return text ? JSON.parse( text ) : {};
	} finally {
		await client.close();
	}
}

export async function callDataLiberationCapture(
	args: Record< string, unknown >,
	engineDir = getDataLiberationEngineDir()
): Promise< unknown > {
	const { chromium } = await import( 'playwright' );
	const browserProblem = await ensurePlaywrightChromiumInstalled( chromium );
	if ( browserProblem ) {
		throw new Error( browserProblem );
	}

	const bundle = path.join( engineDir, 'dist', 'capture-engine.bundle.mjs' );
	if ( ! existsSync( bundle ) ) {
		throw new Error(
			'Data Liberation capture engine is not compiled. Run `npm run cli:build` and try again.'
		);
	}
	const engine = ( await import( /* @vite-ignore */ pathToFileURL( bundle ).href ) ) as {
		captureWebsite: ( captureArgs: Record< string, unknown > ) => Promise< unknown >;
	};
	return engine.captureWebsite( args );
}

export async function captureWebsite(
	url: string,
	outputDir: string,
	options: CaptureOptions = {}
): Promise< CaptureResult > {
	let parsed: URL;
	try {
		parsed = new URL( url );
	} catch ( error ) {
		throw new LoggerError( sprintf( __( 'Invalid source URL: %s' ), url ), error );
	}
	if ( ! [ 'http:', 'https:' ].includes( parsed.protocol ) ) {
		throw new LoggerError( __( 'Source URLs must use HTTP or HTTPS.' ) );
	}

	fs.mkdirSync( outputDir, { recursive: true } );
	const result = ( await ( options.capture ?? callDataLiberationCapture )( {
		url: parsed.href,
		outputDir,
		resume: options.resume ?? false,
		captureImages: false,
		onProgress: options.onProgress,
	} ) ) as Record< string, unknown >;
	const artifactPath = result.artifactPath;
	if ( typeof artifactPath !== 'string' || ! fs.existsSync( artifactPath ) ) {
		throw new LoggerError(
			__( 'Data Liberation completed without a replayable website artifact.' )
		);
	}
	const captureReceiptPath = result.captureReceiptPath;
	if ( typeof captureReceiptPath === 'string' && fs.existsSync( captureReceiptPath ) ) {
		try {
			const receipt = JSON.parse( fs.readFileSync( captureReceiptPath, 'utf8' ) ) as Record<
				string,
				unknown
			>;
			if (
				receipt.schema !== 'data-liberation/capture-receipt/v1' ||
				typeof receipt.entrypoint !== 'string' ||
				! Array.isArray( receipt.routes )
			) {
				throw new Error( 'Capture receipt has an invalid shape.' );
			}
		} catch ( error ) {
			throw new LoggerError( __( 'Data Liberation produced an invalid website artifact.' ), error );
		}
	} else {
		let artifact: unknown;
		try {
			artifact = JSON.parse( fs.readFileSync( artifactPath, 'utf8' ) );
		} catch ( error ) {
			throw new LoggerError( __( 'Data Liberation produced an invalid website artifact.' ), error );
		}
		if (
			! artifact ||
			typeof artifact !== 'object' ||
			( artifact as Record< string, unknown > ).schema !==
				'blocks-engine/php-transformer/site-artifact/v1' ||
			typeof ( artifact as Record< string, unknown > ).entrypoint !== 'string' ||
			! Array.isArray( ( artifact as Record< string, unknown > ).files )
		) {
			throw new LoggerError( __( 'Data Liberation produced an invalid website artifact.' ) );
		}
	}

	return {
		artifactPath,
		outputDir,
		provenance:
			result.provenance &&
			typeof result.provenance === 'object' &&
			! Array.isArray( result.provenance )
				? ( result.provenance as Record< string, unknown > )
				: {},
	};
}
