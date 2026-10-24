import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createMcpTools,
	isUserMcpTool,
	readMcpServers,
	wpcomApproval,
	type McpServerSpec,
} from '../mcp-tools';
import type { Confirmer } from '../confirmation';

const FIXTURE: McpServerSpec = {
	name: 'shop',
	command: process.execPath,
	args: [ path.join( import.meta.dirname, 'fixtures', 'mcp-server.mjs' ) ],
	approval: wpcomApproval,
};

async function toolsOf( confirm: Confirmer = async () => undefined ) {
	const tools = await createMcpTools( [ FIXTURE ], confirm );
	return Object.fromEntries( tools.map( ( tool ) => [ tool.name, tool ] ) );
}

const textOf = ( result: { content: { type: string; text?: string }[] } ) =>
	result.content.map( ( item ) => item.text ).join( '' );

describe( 'MCP tools', () => {
	const dirs: string[] = [];
	afterEach( () => {
		vi.unstubAllEnvs();
		dirs.splice( 0 ).forEach( ( dir ) => rmSync( dir, { recursive: true, force: true } ) );
	} );

	it( "serves a server's tools under its name, without the argument the harness owns", async () => {
		const tools = await toolsOf();
		expect( Object.keys( tools ) ).toEqual( [ 'shop_read', 'shop_write' ] );
		expect( tools.shop_write.parameters ).toEqual( {
			type: 'object',
			properties: { id: { type: 'string' } },
			required: [ 'id' ],
		} );
		expect( textOf( await tools.shop_read.execute( 't', { id: '4' } ) ) ).toBe( 'read 4' );
		expect( isUserMcpTool( 'shop_read' ) ).toBe( true );
	} );

	it.each( [
		{ answer: undefined, outcome: 'wrote 4' },
		{ answer: 'Not run: the user answered "No"', outcome: /the user answered "No"/ },
	] )( 'sends an approval the server asks for only once the user gives it', async ( c ) => {
		const confirm = vi.fn( async () => c.answer );
		const tools = await toolsOf( confirm );
		// The model cannot approve on the user's behalf.
		const run = tools.shop_write.execute( 't', { id: '4', user_confirmed: true } );
		if ( typeof c.outcome === 'string' ) {
			expect( textOf( await run ) ).toBe( c.outcome );
		} else {
			await expect( run ).rejects.toThrow( c.outcome );
		}
		expect( confirm ).toHaveBeenCalledWith( {
			question: 'Run Write for site 1?',
			consequence: 'Requested action: Retitle the post.',
		} );
	} );

	it( "leaves out a tool named like the harness's own or an earlier server's", async () => {
		const tools = await createMcpTools(
			[ FIXTURE, { ...FIXTURE, name: 'shop' } ],
			async () => undefined,
			[ 'shop_write' ]
		);
		expect( tools.map( ( tool ) => tool.name ) ).toEqual( [ 'shop_read' ] );
	} );

	it( "fails with the server's own error", async () => {
		const confirm = vi.fn( async () => undefined );
		const tools = await toolsOf( confirm );
		await expect( tools.shop_write.execute( 't', { id: 'missing' } ) ).rejects.toThrow(
			'No post missing.'
		);
		expect( confirm ).not.toHaveBeenCalled();
	} );

	it( "reads the user's servers from mcp.json and leaves out one that doesn't answer", async () => {
		const dir = mkdtempSync( path.join( os.tmpdir(), 'studio-mcp-' ) );
		dirs.push( dir );
		vi.stubEnv( 'DEV_CONFIG_DIR', dir );
		writeFileSync(
			path.join( dir, 'mcp.json' ),
			JSON.stringify( {
				mcpServers: {
					shop: { command: FIXTURE.command, args: FIXTURE.args },
					gone: { url: 'http://127.0.0.1:9/mcp' },
					empty: {},
				},
			} )
		);
		const servers = await readMcpServers();
		expect( servers.map( ( server ) => server.name ) ).toEqual( [ 'shop', 'gone' ] );
		const tools = await createMcpTools( servers, async () => undefined );
		expect( tools.map( ( tool ) => tool.name ) ).toEqual( [ 'shop_read', 'shop_write' ] );
	} );
} );
