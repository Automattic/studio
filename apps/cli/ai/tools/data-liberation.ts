import { spawn } from 'child_process';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Type } from 'typebox';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { defineTool } from './define-tool';
import { textResult } from './utils';

const ENGINE_DIR = path.join( STUDIO_SITES_ROOT, '_liberations', 'data-liberation' );
const ENGINE_REPO = 'https://github.com/Automattic/data-liberation-agent.git';

// Engine operations (extract, screenshot, reconstruct) drive Playwright and
// routinely run for minutes — far past the MCP SDK's 60s default request
// timeout, which otherwise surfaces as `MCP error -32001: Request timed out`.
// Use a generous, env-overridable per-call timeout. NOTE: this is effectively a
// FLAT cap — the engine emits no MCP progress notifications, so the
// `resetTimeoutOnProgress` flag we pass is currently inert (kept as a no-op
// in case the engine adds notifications later). A single op that exceeds the
// cap still returns -32001 while the engine keeps running in the background;
// the `/liberate` skill handles that by polling `liberate_status` rather than
// re-invoking.
const ENGINE_CALL_TIMEOUT_MS = 600_000;

function appendBoundedOutput( current: string, chunk: unknown ): string {
	const PROCESS_OUTPUT_LIMIT = 2000;

	return ( current + String( chunk ) ).slice( -PROCESS_OUTPUT_LIMIT );
}

function runProcess( command: string, args: string[], cwd: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( command, args, { cwd, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
		let stdout = '';
		let stderr = '';
		child.stdout?.on( 'data', ( chunk ) => {
			stdout = appendBoundedOutput( stdout, chunk );
		} );
		child.stderr?.on( 'data', ( chunk ) => {
			stderr = appendBoundedOutput( stderr, chunk );
		} );
		child.on( 'error', reject );
		child.on( 'close', ( code ) => {
			if ( code === 0 ) {
				resolve();
			} else {
				reject(
					new Error(
						`\`${ command } ${ args.join(
							' '
						) }\` exited with code ${ code }.\nstdout:\n${ stdout }\nstderr:\n${ stderr }`
					)
				);
			}
		} );
	} );
}

function isEngineInstalled(): boolean {
	return (
		existsSync( path.join( ENGINE_DIR, 'node_modules' ) ) &&
		existsSync( path.join( ENGINE_DIR, 'src', 'mcp-server.ts' ) )
	);
}

let enginePromise: Promise< boolean > | null = null;

function ensureEngine(): Promise< boolean > {
	if ( ! enginePromise ) {
		enginePromise = installEngine().catch( ( error ) => {
			enginePromise = null;
			throw error;
		} );
	}
	return enginePromise;
}

async function installEngine(): Promise< boolean > {
	if ( isEngineInstalled() ) {
		return true;
	}

	await fs.mkdir( path.dirname( ENGINE_DIR ), { recursive: true } );

	await runProcess(
		'git',
		[ 'clone', '--depth', '1', '--branch', 'main', ENGINE_REPO, ENGINE_DIR ],
		STUDIO_SITES_ROOT
	);

	await runProcess( 'npm', [ 'ci' ], ENGINE_DIR );

	return false;
}

let clientPromise: Promise< Client > | null = null;

function getClient( engineDir: string ): Promise< Client > {
	if ( ! clientPromise ) {
		clientPromise = connectClient( engineDir ).catch( ( error ) => {
			clientPromise = null;
			throw error;
		} );
	}
	return clientPromise;
}

async function connectClient( engineDir: string ): Promise< Client > {
	// Launch via the engine's own local `tsx` bin — matches how the engine runs
	// its MCP server (`npx tsx src/mcp-server.ts`) and avoids depending on `npx`
	// being on PATH inside the packaged app.
	const tsxBin = path.join(
		engineDir,
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
	);
	const transport = new StdioClientTransport( {
		command: tsxBin,
		args: [ 'src/mcp-server.ts' ],
		cwd: engineDir,
		stderr: 'pipe',
	} );
	const client = new Client( { name: 'studio-code', version: '1.0.0' }, { capabilities: {} } );
	await client.connect( transport );
	return client;
}

interface DataLiberationResultContent {
	type: string;
	text?: string;
	[ key: string ]: unknown;
}

// The model sometimes fills `args` with a JSON-encoded STRING instead of a real
// object. Forwarding that as MCP `arguments` fails the SDK's request schema
// (`arguments` must be a record) with "expected record, invalid_type". Coerce
// to a plain object here so either form works.
function coerceArgs( raw: unknown ): Record< string, unknown > {
	if ( raw === undefined || raw === null ) {
		return {};
	}
	if ( typeof raw === 'string' ) {
		const trimmed = raw.trim();
		if ( ! trimmed ) {
			return {};
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse( trimmed );
		} catch {
			throw new Error(
				`data_liberation: \`args\` was a string that is not valid JSON. Pass \`args\` as an object, e.g. { "url": "https://example.com" }. Received: ${ trimmed.slice(
					0,
					200
				) }`
			);
		}
		raw = parsed;
	}
	if ( typeof raw !== 'object' || Array.isArray( raw ) ) {
		throw new Error(
			`data_liberation: \`args\` must be a JSON object, received ${
				Array.isArray( raw ) ? 'an array' : typeof raw
			}.`
		);
	}
	return raw as Record< string, unknown >;
}

export const dataLiberationTool = defineTool(
	'data_liberation',
	'Bridge to the Data Liberation engine, which extracts content from closed web platforms ' +
		'(GoDaddy, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) ' +
		'and reconstructs it into a WordPress site. This tool forwards a single call to the engine; ' +
		"the `/liberate` skill orchestrates the full sequence. Omit `tool` (or pass 'setup') to " +
		'install/locate the engine and learn where its skill files live. The FIRST call downloads ' +
		'the engine (git clone + npm install + a headless-browser download) and can take several minutes.',
	{
		tool: Type.Optional(
			Type.String( {
				description:
					"Engine MCP tool name, e.g. 'liberate_detect', 'liberate_discover', 'liberate_extract', " +
					"'liberate_reconstruct_pages', 'liberate_install_theme'. Omit or pass 'setup' to just " +
					"install/locate the engine. Pass 'list' to fetch the full catalog of engine tools with " +
					'their argument schemas — consult it whenever you are unsure of a tool name or its arguments.',
			} )
		),
		args: Type.Optional(
			Type.Unknown( {
				description:
					'Arguments forwarded to the engine tool. MUST be a JSON OBJECT, not a stringified ' +
					'JSON — e.g. { "url": "https://example.com" }, NOT "{\\"url\\":\\"…\\"}". ' +
					"Site-targeting tools expect a Studio target, e.g. { kind: 'studio', sitePath: '/Users/you/Studio/my-site' }.",
			} )
		),
	},
	async ( args ) => {
		if ( ! args.tool || args.tool === 'setup' ) {
			const wasEngineInstalled = await ensureEngine();

			return textResult(
				JSON.stringify( {
					ready: true,
					alreadyInstalled: wasEngineInstalled,
					engineDir: ENGINE_DIR,
					skillsDir: path.join( ENGINE_DIR, 'skills' ),
					liberateSkill: path.join( ENGINE_DIR, 'skills', 'liberate', 'SKILL.md' ),
				} )
			);
		}

		const client = await getClient( ENGINE_DIR );

		if ( args.tool === 'list' ) {
			const listed = await client.listTools();
			return textResult( JSON.stringify( listed.tools, null, 2 ) );
		}

		const result = await client.callTool(
			{
				name: args.tool,
				arguments: coerceArgs( args.args ),
			},
			undefined,
			{ timeout: ENGINE_CALL_TIMEOUT_MS, resetTimeoutOnProgress: true }
		);

		const rawContent = Array.isArray( result.content )
			? ( result.content as DataLiberationResultContent[] )
			: [];
		const text = rawContent
			.map( ( part ) => ( part.type === 'text' ? part.text ?? '' : `[${ part.type }]` ) )
			.join( '\n' );

		if ( result.isError ) {
			throw new Error( `Engine tool ${ args.tool } failed: ${ text }` );
		}

		return textResult( text );
	}
);
