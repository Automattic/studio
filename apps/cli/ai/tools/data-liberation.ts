import { existsSync } from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Type } from 'typebox';
import { ensurePlaywrightChromiumInstalled } from '../browser-utils';
import { defineTool } from './define-tool';
import { textResult } from './utils';

const engineDir = path.join( import.meta.dirname, 'data-liberation-agent' );

// Engine ops (extract/screenshot/reconstruct) routinely run for minutes; the MCP SDK's
// 60 s default times them out (-32001) even though the engine keeps working.
const ENGINE_CALL_TIMEOUT_MS = 600_000;

let chromiumPromise: Promise< void > | null = null;

function ensureEngineChromium(): Promise< void > {
	if ( ! chromiumPromise ) {
		chromiumPromise = ( async () => {
			const { chromium } = await import( 'playwright' );
			const problem = await ensurePlaywrightChromiumInstalled( chromium );
			if ( problem ) {
				chromiumPromise = null; // allow a retry on the next tool call
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
	if ( ! existsSync( path.join( engineDir, 'dist', 'mcp-server.bundle.mjs' ) ) ) {
		throw new Error(
			'Data Liberation engine is not compiled. Run `npm run cli:build` — it builds the ' +
				'`data-liberation` MCP bundle and copies it into `dist/cli`.'
		);
	}

	const transport = new StdioClientTransport( {
		command: process.execPath,
		args: [ path.join( engineDir, 'dist', 'mcp-server.bundle.mjs' ) ],
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

// The model sometimes sends `args` as a JSON-encoded STRING instead of an object;
// forwarding that as MCP `arguments` fails the SDK schema ("expected record").
// Coerce nullish → {}, a JSON string → its parsed object, and reject anything else.
function normalizeArgs( raw: unknown ): Record< string, unknown > {
	let value = raw;
	if ( typeof value === 'string' ) {
		const trimmed = value.trim();
		if ( ! trimmed ) {
			return {};
		}
		try {
			value = JSON.parse( trimmed );
		} catch {
			throw new Error(
				`data_liberation: \`args\` must be a JSON object, not a stringified JSON. Received: ${ trimmed.slice(
					0,
					200
				) }`
			);
		}
	}
	if ( value === undefined || value === null ) {
		return {};
	}
	if ( typeof value !== 'object' || Array.isArray( value ) ) {
		throw new Error( 'data_liberation: `args` must be a JSON object.' );
	}
	return value as Record< string, unknown >;
}

export const dataLiberationTool = defineTool(
	'data_liberation',
	'Bridge to the Data Liberation engine, which extracts content from closed web platforms ' +
		'(GoDaddy, Hostinger, HubSpot, Shopify, Squarespace, Webflow, Weebly, Wix) ' +
		'and reconstructs it into a WordPress site. This tool forwards a single call to the engine; ' +
		"the `/liberate` skill orchestrates the full sequence. Pass `tool: 'setup'` to get the paths " +
		'to its skill files (the engine ships prebuilt with Studio).',
	{
		tool: Type.Optional(
			Type.String( {
				description:
					"Engine MCP tool name, e.g. 'liberate_detect', 'liberate_discover', 'liberate_extract', " +
					"'liberate_reconstruct_pages', 'liberate_install_theme'. Pass 'setup' to get the engine's " +
					"skill-file paths, or 'list' to fetch the full catalog of engine tools with " +
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
		if ( ! args.tool ) {
			throw new Error(
				'data_liberation: a `tool` is required. Pass "setup" to get the engine skill-file paths, ' +
					'"list" for the tool catalog, or an engine tool name (e.g. "liberate_detect").'
			);
		}

		if ( args.tool === 'setup' ) {
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

		await ensureEngineChromium();

		const result = await client.callTool(
			{
				name: args.tool,
				arguments: normalizeArgs( args.args ),
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
