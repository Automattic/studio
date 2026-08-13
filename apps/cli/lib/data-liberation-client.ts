import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ensurePlaywrightChromiumInstalled } from 'cli/ai/browser-utils';

const ENGINE_CALL_TIMEOUT_MS = 600_000;

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
