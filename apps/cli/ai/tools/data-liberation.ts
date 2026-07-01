import { existsSync } from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Type } from 'typebox';
import { ensurePlaywrightChromiumInstalled } from '../browser-utils';
import { defineTool } from './define-tool';
import { textResult } from './utils';

// Engine operations (extract, screenshot, reconstruct) drive Playwright and
// routinely run for minutes — far past the MCP SDK's 60s default request
// timeout, which otherwise surfaces as `MCP error -32001: Request timed out`.
// Use a generous per-call timeout. NOTE: this is effectively a FLAT cap — the
// engine emits no MCP progress notifications, so the `resetTimeoutOnProgress`
// flag we pass is currently inert (kept as a no-op in case the engine adds
// notifications later). A single op that exceeds the cap still returns -32001
// while the engine keeps running in the background; the `/liberate` skill
// handles that by polling `liberate_status` rather than re-invoking.
const ENGINE_CALL_TIMEOUT_MS = 600_000;

const engineDir = path.join( import.meta.dirname, 'data-liberation-agent' );

// The engine drives Playwright (extract / screenshot / reconstruct) but ships no
// browser binary. Playwright is deduped to a single version shared with Studio, so
// the engine launches the same managed Chromium — provision it with Studio's shared
// helper before connecting. Best-effort + memoized: a failure must NOT block the
// non-browser tools (detect/discover/paths) — those still work.
let chromiumPromise: Promise< void > | null = null;

function ensureEngineChromium(): Promise< void > {
	if ( ! chromiumPromise ) {
		chromiumPromise = ( async () => {
			const { chromium } = await import( 'playwright' );
			const problem = await ensurePlaywrightChromiumInstalled( chromium );
			if ( problem ) {
				chromiumPromise = null; // allow a retry on the next connect
				console.error(
					`[data_liberation] ${ problem } Browser-dependent steps (extract/screenshot/reconstruct) may fail.`
				);
			}
		} )();
	}
	return chromiumPromise;
}

let clientPromise: Promise< Client > | null = null;

function getClient(): Promise< Client > {
	if ( ! clientPromise ) {
		clientPromise = connectClient().catch( ( error ) => {
			clientPromise = null;
			throw error;
		} );
	}
	return clientPromise;
}

async function connectClient(): Promise< Client > {
	if ( ! existsSync( path.join( engineDir, 'dist', 'mcp-server.js' ) ) ) {
		throw new Error(
			'Data Liberation engine is not compiled. Run `npm run cli:build` — it builds the ' +
				'`data-liberation` workspace and bundles it into `dist/cli`.'
		);
	}

	// Ensure the engine's Chromium is present before any tool runs (best-effort;
	// a one-time ~150MB download on the first connect per machine, then cached).
	await ensureEngineChromium();

	// Run the compiled MCP server with the current Node binary
	const transport = new StdioClientTransport( {
		command: process.execPath,
		args: [ path.join( engineDir, 'dist', 'mcp-server.js' ) ],
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
		'locate the engine and learn where its skill files live (the engine ships prebuilt with Studio).',
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
			return textResult(
				JSON.stringify( {
					engineDir,
					skillsDir: path.join( engineDir, 'skills' ),
					liberateSkill: path.join( engineDir, 'skills', 'liberate', 'SKILL.md' ),
				} )
			);
		}

		const client = await getClient();

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
