// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	InMemoryTransport,
	PROTOCOL_VERSION_META_KEY,
	type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serveMcp } from 'cli/ai/runtimes/mcp';
import { DESIGN_PICKER_URI } from 'cli/ai/runtimes/mcp/design-picker';
import * as tracks from 'cli/lib/tracks';

vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'cli/lib/i18n', () => ( { getAppLocale: async () => 'en' } ) );

const APPS = { extensions: { 'io.modelcontextprotocol/ui': {} } };

interface Listing {
	tools: { name: string; description: string; _meta?: unknown }[];
	resources: { uri: string }[];
	skills: { frontmatter: { name: string } }[];
}

// A client as the wire sees it: on the 2025 revisions it names itself once, in `initialize`;
// on 2026-07-28 it does so in every request.
async function connect( revision: 'old' | 'new', name: string, capabilities: object = {} ) {
	const [ wire, serverSide ] = InMemoryTransport.createLinkedPair();
	const connection = await serveMcp( serverSide );
	const answers = new Map< number, ( message: { result?: unknown; error?: unknown } ) => void >();
	const notices: string[] = [];
	wire.onmessage = ( message: JSONRPCMessage ) => {
		if ( 'method' in message ) {
			notices.push( message.method );
		} else {
			answers.get( message.id as number )?.( message );
		}
	};
	await wire.start();
	let lastId = 0;
	const envelope = {
		[ PROTOCOL_VERSION_META_KEY ]: '2026-07-28',
		[ CLIENT_INFO_META_KEY ]: { name, version: '1.0.0' },
		[ CLIENT_CAPABILITIES_META_KEY ]: capabilities,
	};
	const request = async < T >( method: string, params: Record< string, unknown > = {} ) => {
		const id = ++lastId;
		const answer = new Promise< { result?: unknown; error?: unknown } >( ( resolve ) =>
			answers.set( id, resolve )
		);
		await wire.send( {
			jsonrpc: '2.0',
			id,
			method,
			params: revision === 'new' ? { ...params, _meta: envelope } : params,
		} );
		const { result, error } = await answer;
		if ( error ) {
			throw new Error( JSON.stringify( error ) );
		}
		return result as T;
	};
	if ( revision === 'old' ) {
		await request( 'initialize', {
			protocolVersion: '2025-11-25',
			capabilities,
			clientInfo: { name, version: '1.0.0' },
		} );
		await wire.send( { jsonrpc: '2.0', method: 'notifications/initialized' } );
	}
	return {
		notices,
		tools: async () => ( await request< Listing >( 'tools/list' ) ).tools,
		resources: async () =>
			( await request< Listing >( 'resources/list' ) ).resources.map( ( { uri } ) => uri ),
		skills: async () =>
			( await request< Listing >( 'skills/list' ) ).skills.map(
				( skill ) => skill.frontmatter.name
			),
		close: () => connection.close(),
	};
}

describe.each( [ 'old', 'new' ] as const )(
	'studio mcp on the %s protocol revisions',
	( revision ) => {
		let directory: string;
		let sessionStart: ReturnType< typeof vi.spyOn >;

		beforeEach( async () => {
			directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-mcp-server-' ) );
			vi.stubEnv( 'DEV_CONFIG_DIR', directory );
			vi.stubEnv( 'STUDIO_PLUGIN_ID', '' );
			vi.stubEnv( 'STUDIO_MCP_CLIENT', '' );
			vi.spyOn( os, 'homedir' ).mockReturnValue( directory );
			sessionStart = vi.spyOn( tracks, 'recordTracksEvent' ).mockResolvedValue( undefined );
		} );

		afterEach( async () => {
			vi.restoreAllMocks();
			vi.unstubAllEnvs();
			await fs.rm( directory, { recursive: true, force: true } );
		} );

		it( 'serves the tools and pages that fit the client', async () => {
			const plain = await connect( revision, 'some-agent' );
			const plainTools = await plain.tools();
			expect( plainTools[ 0 ].name ).toBe( 'studio_instructions' );
			expect( plainTools.map( ( tool ) => tool.name ) ).toContain( 'wpcom_request' );
			expect(
				plainTools.find( ( tool ) => tool.name === 'present_design_options' )?._meta
			).toBeUndefined();
			expect( await plain.resources() ).toEqual( [] );
			expect( process.env.STUDIO_MCP_CLIENT ).toBe( 'some-agent' );
			expect( sessionStart ).toHaveBeenCalledTimes( 1 );
			await plain.close();

			// Codex renders MCP Apps without declaring them, and gets no wpcom_request.
			const codex = await connect( revision, 'codex-mcp-client' );
			const codexTools = await codex.tools();
			expect( codexTools.map( ( tool ) => tool.name ) ).not.toContain( 'wpcom_request' );
			expect(
				codexTools.find( ( tool ) => tool.name === 'present_design_options' )?._meta
			).toEqual( {
				ui: { resourceUri: DESIGN_PICKER_URI },
			} );
			expect( await codex.resources() ).toContain( DESIGN_PICKER_URI );
			await codex.close();

			const apps = await connect( revision, 'some-agent', APPS );
			await apps.tools();
			expect( await apps.resources() ).toContain( DESIGN_PICKER_URI );
			await apps.close();
		} );

		it( "leaves Studio's skills to a client that asks for them", async () => {
			const client = await connect( revision, 'some-agent' );
			const description = async () =>
				( await client.tools() ).find( ( tool ) => tool.name === 'studio_instructions' )!
					.description;
			expect( await description() ).toContain( '- build-site: ' );

			expect( await client.skills() ).toContain( 'build-site' );
			expect( await description() ).not.toContain( '- build-site: ' );
			await client.close();

			const declared = await connect( revision, 'some-agent', {
				extensions: { 'io.modelcontextprotocol/skills': {} },
			} );
			expect(
				( await declared.tools() ).find( ( tool ) => tool.name === 'studio_instructions' )!
					.description
			).not.toContain( '- build-site: ' );
			await declared.close();
		} );
	}
);

it( 'tells a client on the 2025 revisions that its tools changed once it asks for the skills', async () => {
	const directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-mcp-server-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	vi.stubEnv( 'STUDIO_PLUGIN_ID', '' );
	vi.spyOn( os, 'homedir' ).mockReturnValue( directory );
	vi.spyOn( tracks, 'recordTracksEvent' ).mockResolvedValue( undefined );

	const client = await connect( 'old', 'some-agent' );
	await client.skills();
	await client.skills();
	await vi.waitFor( () =>
		expect( client.notices ).toEqual( [ 'notifications/tools/list_changed' ] )
	);
	await client.close();

	// The plugin lists Studio's skills itself, so its server's tools stay as they are.
	vi.stubEnv( 'STUDIO_PLUGIN_ID', 'wp-studio@studio' );
	const plugin = await connect( 'old', 'some-agent' );
	expect( await plugin.skills() ).toEqual( [] );
	await plugin.tools();
	expect( plugin.notices ).toEqual( [] );
	await plugin.close();

	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await fs.rm( directory, { recursive: true, force: true } );
} );
