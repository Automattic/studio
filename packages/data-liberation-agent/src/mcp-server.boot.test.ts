import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER = fileURLToPath( new URL( './mcp-server.ts', import.meta.url ) );

/**
 * Boot the server over stdio and ask what it offers.
 *
 * The surface is the product's three verbs. This asserts the count as well as
 * the names: the previous server grew to thirty-nine tools by exposing every
 * internal pipeline phase, and nothing failed when it did.
 */
function listTools(): Promise< Array< { name: string } > > {
	return new Promise( ( resolve, reject ) => {
		const child = spawn( 'npx', [ 'tsx', SERVER ], { stdio: [ 'pipe', 'pipe', 'pipe' ] } );
		let buffer = '';
		const timer = setTimeout( () => {
			child.kill();
			reject( new Error( `MCP server did not answer. stdout: ${ buffer }` ) );
		}, 60_000 );

		child.stdout.on( 'data', ( chunk ) => {
			buffer += String( chunk );
			for ( const line of buffer.split( '\n' ) ) {
				if ( ! line.trim().startsWith( '{' ) ) continue;
				try {
					const message = JSON.parse( line ) as { id?: number; result?: { tools?: Array< { name: string } > } };
					if ( message.id === 2 && message.result?.tools ) {
						clearTimeout( timer );
						child.kill();
						resolve( message.result.tools );
						return;
					}
				} catch {
					/* partial line; wait for more */
				}
			}
		} );
		child.on( 'error', reject );

		child.stdin.write(
			`${ JSON.stringify( {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'test', version: '1' },
				},
			} ) }\n`
		);
		child.stdin.write(
			`${ JSON.stringify( { jsonrpc: '2.0', method: 'notifications/initialized' } ) }\n`
		);
		child.stdin.write( `${ JSON.stringify( { jsonrpc: '2.0', id: 2, method: 'tools/list' } ) }\n` );
	} );
}

describe( 'mcp server', () => {
	it( 'boots and offers the product verbs, and only those', async () => {
		const tools = await listTools();
		expect( tools.map( ( tool ) => tool.name ).sort() ).toEqual( [ 'compare', 'liberate', 'publish' ] );
	}, 90_000 );
} );
