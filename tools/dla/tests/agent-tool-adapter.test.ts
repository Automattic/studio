/**
 * Tests for `adaptMcpToolToPi` — the MCP tool descriptor → pi
 * `ToolDefinition` shim.
 *
 * Covers schema-cast shape preservation, abort-signal forwarding, error
 * propagation when the remote returns `isError: true`, content adaptation,
 * and the policy-block path.
 */
import { describe, expect, it, vi } from 'vitest';
import { adaptMcpToolToPi, DlaPolicyError, type RemoteMcpTool } from '../agent-tool-adapter';

const FAKE_REMOTE_TOOL: RemoteMcpTool = {
	name: 'liberate_inspect',
	description: 'Inspect a source site',
	inputSchema: {
		type: 'object',
		properties: { url: { type: 'string' } },
		required: [ 'url' ],
	},
};

function makeClient(
	overrides: {
		callTool?: ReturnType< typeof vi.fn >;
	} = {}
) {
	return {
		callTool:
			overrides.callTool ??
			vi.fn().mockResolvedValue( {
				content: [ { type: 'text', text: 'ok' } ],
			} ),
	};
}

// Minimal ExtensionContext stub — `execute` does not read from ctx in
// the adapter, so an empty object is enough.
const fakeCtx = {} as unknown as Parameters<
	ReturnType< typeof adaptMcpToolToPi >[ 'execute' ]
>[ 4 ];

describe( 'adaptMcpToolToPi', () => {
	it( 'preserves name, label, description, and parameters', () => {
		const client = makeClient();
		const tool = adaptMcpToolToPi( FAKE_REMOTE_TOOL, client as never );

		expect( tool.name ).toBe( 'liberate_inspect' );
		expect( tool.label ).toBe( 'liberate_inspect' );
		expect( tool.description ).toBe( 'Inspect a source site' );
		// Reference equality — we want to know the JSON Schema is passed
		// through unchanged so pi-ai can compile it directly.
		expect( tool.parameters ).toBe( FAKE_REMOTE_TOOL.inputSchema );
	} );

	it( 'forwards the abort signal to client.callTool', async () => {
		const client = makeClient();
		const tool = adaptMcpToolToPi( FAKE_REMOTE_TOOL, client as never );

		const controller = new AbortController();
		await tool.execute(
			'tc-1',
			{ url: 'https://example.com' },
			controller.signal,
			undefined,
			fakeCtx
		);

		expect( client.callTool ).toHaveBeenCalledWith(
			{
				name: 'liberate_inspect',
				arguments: { url: 'https://example.com' },
			},
			undefined,
			{ signal: controller.signal }
		);
	} );

	it( 'adapts text content blocks into pi content', async () => {
		const client = makeClient( {
			callTool: vi.fn().mockResolvedValue( {
				content: [ { type: 'text', text: '{"platform":"wix"}' } ],
				structuredContent: { platform: 'wix' },
			} ),
		} );
		const tool = adaptMcpToolToPi( FAKE_REMOTE_TOOL, client as never );

		const result = await tool.execute(
			'tc-2',
			{ url: 'https://example.com' },
			undefined,
			undefined,
			fakeCtx
		);

		expect( result.content ).toEqual( [ { type: 'text', text: '{"platform":"wix"}' } ] );
		expect( result.details ).toEqual( { platform: 'wix' } );
	} );

	it( 'throws when the remote returns isError: true (text payload)', async () => {
		const client = makeClient( {
			callTool: vi.fn().mockResolvedValue( {
				isError: true,
				content: [ { type: 'text', text: 'remote went boom' } ],
			} ),
		} );
		const tool = adaptMcpToolToPi( FAKE_REMOTE_TOOL, client as never );

		await expect(
			tool.execute( 'tc-3', { url: 'https://example.com' }, undefined, undefined, fakeCtx )
		).rejects.toThrow( 'remote went boom' );
	} );

	it( 'throws a fallback message when isError: true has no text content', async () => {
		const client = makeClient( {
			callTool: vi.fn().mockResolvedValue( {
				isError: true,
				content: [],
			} ),
		} );
		const tool = adaptMcpToolToPi( FAKE_REMOTE_TOOL, client as never );

		await expect(
			tool.execute( 'tc-4', { url: 'https://example.com' }, undefined, undefined, fakeCtx )
		).rejects.toThrow( /reported an error without a text payload/ );
	} );

	it( 'throws a DlaPolicyError when policy blocks the call', async () => {
		const importTool: RemoteMcpTool = {
			name: 'liberate_import',
			description: 'Import WXR',
			inputSchema: { type: 'object' },
		};
		const client = makeClient();
		const tool = adaptMcpToolToPi( importTool, client as never );

		await expect(
			tool.execute( 'tc-5', { delegate: false }, undefined, undefined, fakeCtx )
		).rejects.toBeInstanceOf( DlaPolicyError );

		expect( client.callTool ).not.toHaveBeenCalled();
	} );

	it( 'allows the call when policy returns block: false', async () => {
		const importTool: RemoteMcpTool = {
			name: 'liberate_import',
			description: 'Import WXR',
			inputSchema: { type: 'object' },
		};
		const client = makeClient();
		const tool = adaptMcpToolToPi( importTool, client as never );

		await tool.execute( 'tc-6', { delegate: true }, undefined, undefined, fakeCtx );

		expect( client.callTool ).toHaveBeenCalledWith(
			{ name: 'liberate_import', arguments: { delegate: true } },
			undefined,
			{ signal: undefined }
		);
	} );

	it( 'consults the buckets getter on every call (supports policy swaps)', async () => {
		const client = makeClient();
		const getBuckets = vi
			.fn()
			.mockReturnValueOnce( { liberate_inspect: 'read-only' } )
			.mockReturnValueOnce( { liberate_inspect: 'destructive' } );
		const tool = adaptMcpToolToPi( FAKE_REMOTE_TOOL, client as never, {
			getBuckets,
		} );

		// First call: bucket says read-only — should succeed.
		await tool.execute( 'tc-7', { url: 'https://example.com' }, undefined, undefined, fakeCtx );
		expect( client.callTool ).toHaveBeenCalledTimes( 1 );

		// Second call: bucket says destructive (and no delegate) — should
		// be blocked.
		await expect(
			tool.execute( 'tc-8', { url: 'https://example.com' }, undefined, undefined, fakeCtx )
		).rejects.toBeInstanceOf( DlaPolicyError );
		expect( client.callTool ).toHaveBeenCalledTimes( 1 );

		expect( getBuckets ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'defaults a missing description to an empty string', () => {
		const noDesc: RemoteMcpTool = {
			name: 'tool',
			inputSchema: { type: 'object' },
		};
		const tool = adaptMcpToolToPi( noDesc, makeClient() as never );
		expect( tool.description ).toBe( '' );
	} );
} );
