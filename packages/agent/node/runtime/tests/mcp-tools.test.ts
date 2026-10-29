import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wpcomApproval } from '@studio/agent/node/remote-hosts';
import { fakeWpcom } from '@studio/agent/node/tests/fake-host';
import { createMcpTools, isUserMcpTool, readMcpServers, type McpServerSpec } from '../mcp-tools';
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
		expect( textOf( await tools.shop_read.execute( 't', { id: '4' } ) ) ).toMatch( /^read 4/ );
		expect( isUserMcpTool( 'shop_read' ) ).toBe( true );
	} );

	it.each( [
		{ answer: undefined, outcome: 'wrote 4' },
		{ answer: { text: 'Not run: the user answered "No"' }, outcome: /the user answered "No"/ },
		{
			answer: { text: 'Not run: the user closed without answering', endsTurn: true },
			outcome: 'Not run: the user closed without answering',
			terminate: true,
		},
	] )( 'sends an approval the server asks for only once the user gives it', async ( c ) => {
		const confirm = vi.fn( async () => c.answer );
		const tools = await toolsOf( confirm );
		// The model cannot approve on the user's behalf.
		const run = tools.shop_write.execute( 't', { id: '4', user_confirmed: true } );
		if ( typeof c.outcome === 'string' ) {
			const result = await run;
			expect( textOf( result ) ).toBe( c.outcome );
			expect( result.terminate ).toBe( c.terminate );
		} else {
			await expect( run ).rejects.toThrow( c.outcome );
		}
		expect( confirm ).toHaveBeenCalledWith( {
			question: 'Run Write for site 1?',
			consequence: 'Requested action: Retitle the post.',
		} );
	} );

	it( "lists a server's tools once, and again when the server says they changed", async () => {
		const server = { ...FIXTURE, args: [ ...FIXTURE.args!, 'listing' ] };
		const listed = async () => {
			const tools = await createMcpTools( [ server ], async () => undefined );
			const read = tools.find( ( tool ) => tool.name === 'shop_read' )!;
			return {
				names: tools.map( ( tool ) => tool.name ),
				read: textOf( await read.execute( 't', { id: '1' } ) ),
			};
		};
		expect( await listed() ).toEqual( {
			names: [ 'shop_read', 'shop_write' ],
			read: 'read 1, listed 1',
		} );
		expect( ( await listed() ).read ).toBe( 'read 1, listed 1' );

		const [ read ] = await createMcpTools( [ server ], async () => undefined );
		await read.execute( 't', { id: 'grow' } );
		await vi.waitFor( async () =>
			expect( ( await listed() ).names ).toEqual( [ 'shop_grown', 'shop_read', 'shop_write' ] )
		);
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

	it( "serves the signed-in host's own server, then the user's from mcp.json, leaving out one that doesn't answer", async () => {
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
		const wpcom = {
			...fakeWpcom(),
			mcpServer: async () => ( {
				url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v2',
				headers: { Authorization: 'Bearer signed-in' },
				approval: wpcomApproval,
			} ),
		};
		const servers = await readMcpServers( { wpcom } );
		expect( servers.map( ( server ) => server.name ) ).toEqual( [ 'wpcom', 'shop', 'gone' ] );
		expect( servers[ 0 ] ).toMatchObject( {
			headers: { Authorization: 'Bearer signed-in' },
			approval: wpcomApproval,
			builtIn: true,
		} );
		const tools = await createMcpTools( servers.slice( 1 ), async () => undefined );
		expect( tools.map( ( tool ) => tool.name ) ).toEqual( [ 'shop_read', 'shop_write' ] );
	} );
} );
