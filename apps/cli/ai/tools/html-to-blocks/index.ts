import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import manifest from './tools-manifest.json';
import type { AnyStudioAgentTool, ToolContent, ToolResult } from '../define-tool';

// The html-to-blocks / blocks-to-theme engine is a self-contained ESM Node
// program vendored under apps/cli/ai/html-to-blocks-engine. It pulls in heavy
// runtime deps (@wordpress/blocks, jsdom, playwright, pixelmatch) that do not
// belong in the CLI's Vite bundle, so rather than import it we run it as a
// child process and exchange JSON. Each engine tool keeps its original name and
// JSON Schema (see tools-manifest.json, generated from the engine's TOOLS list);
// pi forwards `parameters` verbatim as the model-facing input schema and does
// not validate arguments itself, so the raw schema is exactly what we want.

interface EngineToolDef {
	name: string;
	description: string;
	inputSchema: {
		type?: string;
		required?: string[];
		properties?: Record< string, unknown >;
		additionalProperties?: boolean;
	};
}

// From the bundled CLI (apps/cli/dist/cli/*) back to the engine source.
const ENGINE_RELATIVE_FROM_DIST = '../../ai/html-to-blocks-engine';
// Engine work (Playground boot, font fetch, multi-page screenshot diffs) is slow.
const ENGINE_TIMEOUT_MS = 20 * 60 * 1000;

function resolveEngineDir(): string {
	if ( process.env.H2B_ENGINE_DIR ) {
		return process.env.H2B_ENGINE_DIR;
	}
	return path.resolve( import.meta.dirname, ENGINE_RELATIVE_FROM_DIST );
}

async function runEngineTool( toolName: string, args: unknown ): Promise< string > {
	const engineDir = resolveEngineDir();
	const runner = path.join( engineDir, 'run-tool.mjs' );
	if ( ! existsSync( runner ) ) {
		throw new Error(
			`html-to-blocks engine runner not found at ${ runner }. Set H2B_ENGINE_DIR to the engine directory.`
		);
	}

	const tmpDir = mkdtempSync( path.join( os.tmpdir(), 'h2b-args-' ) );
	const argsPath = path.join( tmpDir, 'args.json' );
	writeFileSync( argsPath, JSON.stringify( args ?? {} ) );

	return new Promise< string >( ( resolve, reject ) => {
		const child = spawn( process.execPath, [ runner, toolName, argsPath ], {
			cwd: engineDir,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			env: process.env,
		} );

		let stdout = '';
		let stderr = '';
		const timer = setTimeout( () => {
			child.kill( 'SIGKILL' );
			reject(
				new Error( `Engine tool ${ toolName } timed out after ${ ENGINE_TIMEOUT_MS / 1000 }s.` )
			);
		}, ENGINE_TIMEOUT_MS );

		child.stdout.on( 'data', ( chunk ) => {
			stdout += chunk;
		} );
		child.stderr.on( 'data', ( chunk ) => {
			stderr += chunk;
		} );
		child.on( 'error', ( error ) => {
			clearTimeout( timer );
			rmSync( tmpDir, { recursive: true, force: true } );
			reject( error );
		} );
		child.on( 'close', () => {
			clearTimeout( timer );
			rmSync( tmpDir, { recursive: true, force: true } );

			let parsed: { ok: boolean; result?: unknown; error?: string };
			try {
				parsed = JSON.parse( stdout );
			} catch {
				reject(
					new Error(
						`Engine tool ${ toolName } returned no parseable JSON.\n` +
							`stderr: ${ stderr.slice( 0, 1500 ) }\nstdout: ${ stdout.slice( 0, 500 ) }`
					)
				);
				return;
			}
			if ( ! parsed.ok ) {
				reject( new Error( parsed.error || `Engine tool ${ toolName } failed.` ) );
				return;
			}
			const result = parsed.result;
			resolve( typeof result === 'string' ? result : JSON.stringify( result, null, 2 ) );
		} );
	} );
}

function makeEngineTool( def: EngineToolDef ): AnyStudioAgentTool {
	const handler = async ( args: unknown ): Promise< ToolResult > => {
		const text = await runEngineTool( def.name, args );
		const content: ToolContent[] = [ { type: 'text', text } ];
		return { content };
	};

	return {
		name: def.name,
		description: def.description,
		label: def.name,
		parameters: def.inputSchema,
		rawHandler: handler as AnyStudioAgentTool[ 'rawHandler' ],
		execute: async ( _toolCallId, params ) => {
			const result = await handler( params );
			return { content: result.content, details: undefined };
		},
	};
}

export const htmlToBlocksTools: AnyStudioAgentTool[] = ( manifest as EngineToolDef[] ).map(
	makeEngineTool
);
