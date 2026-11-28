/** @vitest-environment node */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { updateConfig } from '@studio/common/lib/config/store';
import { describe, expect, it, vi } from 'vitest';

const cli = path.resolve( import.meta.dirname, '../../../../dist/cli/main.mjs' );
const execFileAsync = promisify( execFile );

describe.skipIf( ! fs.existsSync( cli ) )( 'MCP authentication handoff', () => {
	it(
		'keeps local sites available and directs signed-out preview requests to the user',
		{ tags: [ 'e2e' ], timeout: 30_000 },
		async () => {
			const root = path.join( os.tmpdir(), `smcp-${ randomUUID().slice( 0, 8 ) }` );
			const configDir = path.join( root, 'config' );
			const sitePath = path.join( root, 'site' );
			fs.mkdirSync( sitePath, { recursive: true } );
			vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
			vi.stubEnv( 'E2E', '1' );
			vi.stubEnv( 'E2E_APP_DATA_PATH', root );
			try {
				await updateConfig( ( config ) => {
					config.sites.push( {
						id: 'mcp-test',
						name: 'MCP test site',
						path: sitePath,
						port: 8881,
						url: 'http://localhost:8881',
						phpVersion: '8.3',
					} );
				} );
			} finally {
				vi.unstubAllEnvs();
			}
			const env = {
				...process.env,
				DEV_CONFIG_DIR: configDir,
				STUDIO_PROCESS_MANAGER_HOME: root,
				E2E: '1',
				E2E_APP_DATA_PATH: root,
				E2E_SITES_ROOT: root,
				NODE_USE_ENV_PROXY: '1',
				HTTP_PROXY: 'http://127.0.0.1:9',
				HTTPS_PROXY: 'http://127.0.0.1:9',
				NO_PROXY: 'localhost,127.0.0.1,[::1]',
			};
			const transport = new StdioClientTransport( {
				command: process.execPath,
				args: [ cli, 'mcp' ],
				env,
			} );
			const client = new Client( { name: 'studio-auth-test', version: '1.0.0' } );
			try {
				await client.connect( transport );
				expect( client.getInstructions() ).toContain( 'studio auth login' );
				expect( client.getInstructions() ).toContain( 'WordPress library if available' );
				expect( client.getInstructions() ).toContain(
					'Do not run login for them or ask for tokens in chat'
				);
				const local = await client.callTool( { name: 'site_list', arguments: {} } );
				expect( local.isError ).toBe( false );
				expect( JSON.stringify( local.content ) ).toContain( 'MCP test site' );
				const previews = await client.callTool( {
					name: 'preview_list',
					arguments: { nameOrPath: sitePath },
				} );
				expect( previews.isError ).toBe( true );
				expect( JSON.stringify( previews.content ) ).toMatch(
					/Authentication required.*studio auth login/i
				);
			} finally {
				await client.close().catch( () => {} );
				await execFileAsync( process.execPath, [ cli, 'site', 'stop', '--all' ], { env } ).catch(
					() => {}
				);
				fs.rmSync( root, { recursive: true, force: true } );
			}
		}
	);
} );
