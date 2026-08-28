import fs, { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ensurePlaywrightChromiumInstalled } from 'cli/ai/browser-utils';

const ENGINE_CALL_TIMEOUT_MS = 600_000;

export interface DataLiberationProgress {
	phase: 'discovering' | 'capturing' | 'finalizing' | 'complete';
	current?: number;
	total?: number;
	elapsedMs?: number;
}

interface WebsiteArtifactOptions {
	onProgress?: ( progress: DataLiberationProgress ) => void;
	runCapture?: typeof runDataLiberationCapture;
}

export function getDataLiberationEngineDir(): string {
	return path.join( import.meta.dirname, 'data-liberation-agent' );
}

function getEngineBundle( engineDir: string, filename: string, label = 'engine' ): string {
	const bundle = path.join( engineDir, 'dist', filename );
	if ( ! existsSync( bundle ) ) {
		throw new Error(
			`Data Liberation ${ label } is not compiled. Run \`npm run cli:build\` and try again.`
		);
	}
	return bundle;
}

async function ensureDataLiberationBrowser(): Promise< void > {
	const { chromium } = await import( 'playwright' );
	const browserProblem = await ensurePlaywrightChromiumInstalled( chromium );
	if ( browserProblem ) {
		throw new Error( browserProblem );
	}
}

async function connectClient( engineDir: string ): Promise< Client > {
	const transport = new StdioClientTransport( {
		command: process.execPath,
		args: [ getEngineBundle( engineDir, 'mcp-server.bundle.mjs' ) ],
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
		await ensureDataLiberationBrowser();
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

async function runDataLiberationCapture(
	args: Record< string, unknown >,
	engineDir = getDataLiberationEngineDir()
): Promise< unknown > {
	await ensureDataLiberationBrowser();

	const bundle = getEngineBundle( engineDir, 'capture-engine.bundle.mjs', 'capture engine' );
	const engine = ( await import( /* @vite-ignore */ pathToFileURL( bundle ).href ) ) as {
		captureWebsite: ( captureArgs: Record< string, unknown > ) => Promise< unknown >;
	};
	return engine.captureWebsite( args );
}

export async function createWebsiteArtifact(
	url: string,
	outputDir: string,
	options: WebsiteArtifactOptions = {}
): Promise< string > {
	const parsed = new URL( url );
	if ( ! [ 'http:', 'https:' ].includes( parsed.protocol ) ) {
		throw new Error( 'Source URLs must use HTTP or HTTPS.' );
	}

	fs.mkdirSync( outputDir, { recursive: true } );
	const result = ( await ( options.runCapture ?? runDataLiberationCapture )( {
		url: parsed.href,
		outputDir,
		resume: true,
		captureImages: false,
		learnFluid: true,
		onProgress: options.onProgress,
	} ) ) as Record< string, unknown >;
	const artifactPath = result.artifactPath;
	if ( typeof artifactPath !== 'string' || ! fs.existsSync( artifactPath ) ) {
		throw new Error( 'Data Liberation completed without a website artifact.' );
	}

	return artifactPath;
}
