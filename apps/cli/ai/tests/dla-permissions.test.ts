import { describe, expect, it, vi } from 'vitest';
import { buildDlaCanUseTool } from 'cli/ai/dla-permissions';

/**
 * Build the third `options` argument that the SDK passes to a `canUseTool`
 * callback. We supply only what the callback under test inspects — the rest
 * of the surface (signal, suggestions, blockedPath, etc.) is irrelevant for
 * the policy decisions exercised here.
 */
function callContext( overrides: Partial< { toolUseID: string } > = {} ) {
	return {
		signal: new AbortController().signal,
		toolUseID: overrides.toolUseID ?? 'tool-use-1',
	};
}

describe( 'buildDlaCanUseTool', () => {
	const READ_ONLY_TOOLS = [
		'mcp__data-liberation__liberate_detect',
		'mcp__data-liberation__liberate_discover',
		'mcp__data-liberation__liberate_inspect',
		'mcp__data-liberation__liberate_status',
		'mcp__data-liberation__liberate_verify',
	];

	it.each( READ_ONLY_TOOLS )( 'auto-approves read-only DLA tool %s', async ( toolName ) => {
		const onAskUser = vi.fn();
		const canUseTool = buildDlaCanUseTool( { onAskUser } );

		const result = await canUseTool( toolName, { url: 'https://example.com' }, callContext() );

		expect( result ).toEqual( { behavior: 'allow', updatedInput: { url: 'https://example.com' } } );
		expect( onAskUser ).not.toHaveBeenCalled();
	} );

	it( 'passes through non-DLA tools without prompting', async () => {
		const onAskUser = vi.fn();
		const canUseTool = buildDlaCanUseTool( { onAskUser } );

		const result = await canUseTool( 'Read', { path: '/etc/hosts' }, callContext() );

		expect( result ).toEqual( { behavior: 'allow', updatedInput: { path: '/etc/hosts' } } );
		expect( onAskUser ).not.toHaveBeenCalled();
	} );

	it( 'asks for liberate_extract once and remembers the answer for the session', async () => {
		const onAskUser = vi.fn().mockImplementation( async ( questions ) => ( {
			[ questions[ 0 ].question ]: questions[ 0 ].options[ 0 ].label,
		} ) );
		const canUseTool = buildDlaCanUseTool( { onAskUser } );

		const first = await canUseTool(
			'mcp__data-liberation__liberate_extract',
			{ url: 'https://example.com' },
			callContext()
		);
		const second = await canUseTool(
			'mcp__data-liberation__liberate_extract',
			{ url: 'https://example.com/about' },
			callContext()
		);

		expect( first ).toEqual( {
			behavior: 'allow',
			updatedInput: { url: 'https://example.com' },
		} );
		expect( second ).toEqual( {
			behavior: 'allow',
			updatedInput: { url: 'https://example.com/about' },
		} );
		expect( onAskUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'denies when the user declines the ask-once prompt', async () => {
		const onAskUser = vi.fn().mockImplementation( async ( questions ) => ( {
			[ questions[ 0 ].question ]: questions[ 0 ].options[ 1 ].label,
		} ) );
		const canUseTool = buildDlaCanUseTool( { onAskUser } );

		const result = await canUseTool( 'mcp__data-liberation__liberate_extract', {}, callContext() );

		expect( result.behavior ).toBe( 'deny' );
		expect( onAskUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'auto-approves liberate_import when delegate is true', async () => {
		const onAskUser = vi.fn();
		const canUseTool = buildDlaCanUseTool( { onAskUser } );

		const result = await canUseTool(
			'mcp__data-liberation__liberate_import',
			{ delegate: true, manifest: { wxrFile: '/tmp/x.xml' } },
			callContext()
		);

		expect( result ).toEqual( {
			behavior: 'allow',
			updatedInput: { delegate: true, manifest: { wxrFile: '/tmp/x.xml' } },
		} );
		expect( onAskUser ).not.toHaveBeenCalled();
	} );

	it( 'asks for liberate_import when delegate is false', async () => {
		const onAskUser = vi.fn().mockImplementation( async ( questions ) => ( {
			[ questions[ 0 ].question ]: questions[ 0 ].options[ 0 ].label,
		} ) );
		const canUseTool = buildDlaCanUseTool( { onAskUser } );

		const result = await canUseTool(
			'mcp__data-liberation__liberate_import',
			{ delegate: false },
			callContext()
		);

		expect( result.behavior ).toBe( 'allow' );
		expect( onAskUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'asks for liberate_import when delegate is absent', async () => {
		const onAskUser = vi.fn().mockImplementation( async ( questions ) => ( {
			[ questions[ 0 ].question ]: questions[ 0 ].options[ 0 ].label,
		} ) );
		const canUseTool = buildDlaCanUseTool( { onAskUser } );

		const result = await canUseTool( 'mcp__data-liberation__liberate_import', {}, callContext() );

		expect( result.behavior ).toBe( 'allow' );
		expect( onAskUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'denies ask-once tools when no onAskUser handler is configured', async () => {
		const canUseTool = buildDlaCanUseTool();

		const result = await canUseTool( 'mcp__data-liberation__liberate_extract', {}, callContext() );

		expect( result.behavior ).toBe( 'deny' );
	} );

	it( 'auto-approves liberate_import with delegate true even without onAskUser', async () => {
		const canUseTool = buildDlaCanUseTool();

		const result = await canUseTool(
			'mcp__data-liberation__liberate_import',
			{ delegate: true },
			callContext()
		);

		expect( result ).toEqual( {
			behavior: 'allow',
			updatedInput: { delegate: true },
		} );
	} );

	it( 'denies an unknown DLA tool by default', async () => {
		const onAskUser = vi.fn();
		const canUseTool = buildDlaCanUseTool( { onAskUser } );

		const result = await canUseTool(
			'mcp__data-liberation__liberate_unclassified',
			{},
			callContext()
		);

		expect( result.behavior ).toBe( 'deny' );
		expect( onAskUser ).not.toHaveBeenCalled();
	} );
} );
