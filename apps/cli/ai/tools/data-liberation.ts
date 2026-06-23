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

// The Data Liberation engine (https://github.com/Automattic/data-liberation-agent)
// is used UNMODIFIED, as a downloaded dependency. We never bundle it: it is
// cloned on the first `/liberate` run into `~/Studio/_liberations/data-liberation`,
// co-located with the engine's own per-site output (`~/Studio/_liberations/<host>`)
// so everything liberation-related lives in one place — and under
// STUDIO_SITES_ROOT, so the agent's Read/Write/Bash tools (scoped to that root)
// can reach the engine's skill files and outputs.
//
// The engine's public interface is its stdio MCP server (35 `liberate_*`
// tools). pi (Studio Code's agent runtime) has no MCP client, so this tool IS
// the bridge: it spawns the engine's MCP server once and forwards `tools/call`
// over a single, long-lived connection. The connection is memoized for the
// process lifetime so a full reconstruct (dozens of calls) reuses one warm
// engine — and one warm Playwright browser — instead of cold-starting per call.
const ENGINE_DIR = path.join( STUDIO_SITES_ROOT, '_liberations', 'data-liberation' );
const ENGINE_REPO =
	process.env.STUDIO_DATA_LIBERATION_REPO ??
	'https://github.com/Automattic/data-liberation-agent.git';
const ENGINE_REF = process.env.STUDIO_DATA_LIBERATION_REF ?? 'main';

// Engine operations (extract, screenshot, reconstruct) drive Playwright and
// routinely run for minutes — far past the MCP SDK's 60s default request
// timeout, which otherwise surfaces as `MCP error -32001: Request timed out`.
// Use a generous, env-overridable per-call timeout. NOTE: this is effectively a
// FLAT cap — the engine emits no MCP progress notifications, so the
// `resetTimeoutOnProgress` flag we pass is currently inert (kept as a no-op
// in case the engine adds notifications later). A single op that exceeds the
// cap still returns -32001 while the engine keeps running in the background;
// the `/liberate` skill handles that by polling `liberate_status` rather than
// re-invoking. Bump STUDIO_DATA_LIBERATION_TIMEOUT_MS for very large sites.
const ENGINE_CALL_TIMEOUT_MS = Number( process.env.STUDIO_DATA_LIBERATION_TIMEOUT_MS ) || 600_000;

function runProcess( command: string, args: string[], cwd: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( command, args, { cwd, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
		let stderr = '';
		child.stderr?.on( 'data', ( chunk ) => {
			stderr += String( chunk );
		} );
		child.on( 'error', reject );
		child.on( 'close', ( code ) => {
			if ( code === 0 ) {
				resolve();
			} else {
				reject(
					new Error(
						`\`${ command } ${ args.join( ' ' ) }\` exited with code ${ code }: ${ stderr.slice(
							-2000
						) }`
					)
				);
			}
		} );
	} );
}

// True when the engine is already cloned + installed on disk, so a setup call
// can report "already ready" instead of claiming a multi-minute install on
// every run.
function isEngineInstalled(): boolean {
	return (
		existsSync( path.join( ENGINE_DIR, 'node_modules' ) ) &&
		existsSync( path.join( ENGINE_DIR, 'src', 'mcp-server.ts' ) )
	);
}

let enginePromise: Promise< string > | null = null;

// Resolves once the engine is present and installed; returns its directory.
// Idempotent and memoized; a failed attempt clears the memo so a later call
// retries instead of caching the rejection forever.
function ensureEngine(): Promise< string > {
	if ( ! enginePromise ) {
		enginePromise = installEngine().catch( ( error ) => {
			enginePromise = null;
			throw error;
		} );
	}
	return enginePromise;
}

async function installEngine(): Promise< string > {
	if ( isEngineInstalled() ) {
		return ENGINE_DIR;
	}

	await fs.mkdir( path.dirname( ENGINE_DIR ), { recursive: true } );

	if ( ! existsSync( path.join( ENGINE_DIR, '.git' ) ) ) {
		await fs.rm( ENGINE_DIR, { recursive: true, force: true } );
		await runProcess(
			'git',
			[ 'clone', '--depth', '1', '--branch', ENGINE_REF, ENGINE_REPO, ENGINE_DIR ],
			STUDIO_SITES_ROOT
		);
	}

	// `npm ci` installs deps incl. the dev `tsx` we launch the server with, and
	// runs the engine's `postinstall` (`playwright install chromium`). This is
	// the slow, one-time first-run cost.
	await runProcess( 'npm', [ 'ci' ], ENGINE_DIR );

	return ENGINE_DIR;
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
		env: process.env as Record< string, string >,
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
		const isSetup = ! args.tool || args.tool === 'setup';
		// Capture state BEFORE ensureEngine() runs, so we can tell whether THIS
		// call had to install (first run) or the engine was already on disk.
		const alreadyInstalled = isSetup ? isEngineInstalled() : true;

		const engineDir = await ensureEngine();

		// Direct condition (not the `isSetup` alias) so TypeScript narrows
		// `args.tool` to a string in the call branch below.
		if ( ! args.tool || args.tool === 'setup' ) {
			return textResult(
				JSON.stringify( {
					ready: true,
					alreadyInstalled,
					engineDir,
					skillsDir: path.join( engineDir, 'skills' ),
					liberateSkill: path.join( engineDir, 'skills', 'liberate', 'SKILL.md' ),
				} )
			);
		}

		const client = await getClient( engineDir );

		// `list` returns the engine's authoritative tool catalog (names +
		// descriptions + JSON-Schema for arguments) so the model can call any
		// engine tool with correct arguments, the same awareness it would have
		// if the tools were registered natively.
		if ( args.tool === 'list' || args.tool === 'catalog' ) {
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
