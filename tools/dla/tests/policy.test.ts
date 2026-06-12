/**
 * Tests for the per-tool permission policy buckets.
 *
 * Covers each of the 13 DLA tools at the pinned SHA — and the
 * `delegate: true` escape hatch on `liberate_import`, plus the
 * unknown-tool default-deny rule.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDlaPolicyFactory, defaultPolicyBuckets, shouldBlock } from '../policy';

const DLA_TOOLS = [
	'liberate_detect',
	'liberate_discover',
	'liberate_inspect',
	'liberate_status',
	'liberate_extract',
	'liberate_qa',
	'liberate_verify',
	'liberate_setup',
	'liberate_import',
	'liberate_preview',
	'liberate_preview_stop',
	'liberate_map_apis',
	'liberate_probe',
];

describe( 'shouldBlock — default buckets', () => {
	it( 'allows every read-only / network-read / fs-write tool with empty args', () => {
		const allowed = [
			'liberate_detect',
			'liberate_discover',
			'liberate_inspect',
			'liberate_status',
			'liberate_extract',
			'liberate_qa',
			'liberate_verify',
			'liberate_setup',
			'liberate_preview',
			'liberate_preview_stop',
			'liberate_map_apis',
			'liberate_probe',
		];
		for ( const tool of allowed ) {
			const decision = shouldBlock( tool, {} );
			expect( decision.block, `should not block ${ tool }` ).toBe( false );
		}
	} );

	it( 'blocks destructive liberate_import without delegate: true', () => {
		const decision = shouldBlock( 'liberate_import', { delegate: false } );
		expect( decision.block ).toBe( true );
		expect( decision.reason ).toMatch( /delegate.*true/i );
	} );

	it( 'blocks destructive liberate_import with missing delegate flag', () => {
		const decision = shouldBlock( 'liberate_import', {} );
		expect( decision.block ).toBe( true );
	} );

	it( 'allows destructive liberate_import with delegate: true', () => {
		const decision = shouldBlock( 'liberate_import', { delegate: true } );
		expect( decision.block ).toBe( false );
	} );

	it( 'tolerates non-record input on destructive tools (defaults to deny)', () => {
		expect( shouldBlock( 'liberate_import', null ).block ).toBe( true );
		expect( shouldBlock( 'liberate_import', 'string-input' ).block ).toBe( true );
		expect( shouldBlock( 'liberate_import', undefined ).block ).toBe( true );
	} );

	it( 'blocks unknown tools defensively', () => {
		const decision = shouldBlock( 'liberate_made_up', {} );
		expect( decision.block ).toBe( true );
		expect( decision.reason ).toMatch( /unknown/i );
	} );
} );

describe( 'defaultPolicyBuckets', () => {
	it( 'covers all 13 DLA tools at the pinned SHA', () => {
		for ( const tool of DLA_TOOLS ) {
			expect( defaultPolicyBuckets[ tool ], `bucket should be set for ${ tool }` ).toBeDefined();
		}
	} );

	it( 'classifies the single destructive tool correctly', () => {
		expect( defaultPolicyBuckets.liberate_import ).toBe( 'destructive' );
		// no other tool should be destructive
		const destructiveTools = Object.entries( defaultPolicyBuckets )
			.filter( ( [ , bucket ] ) => bucket === 'destructive' )
			.map( ( [ name ] ) => name );
		expect( destructiveTools ).toEqual( [ 'liberate_import' ] );
	} );
} );

describe( 'shouldBlock — custom buckets', () => {
	it( 'honours an override that elevates a tool to destructive', () => {
		const decision = shouldBlock( 'liberate_extract', {}, { liberate_extract: 'destructive' } );
		expect( decision.block ).toBe( true );
	} );

	it( 'honours an override that downgrades liberate_import to read-only', () => {
		const decision = shouldBlock( 'liberate_import', {}, { liberate_import: 'read-only' } );
		expect( decision.block ).toBe( false );
	} );

	it( 'blocks delegate-only tools regardless of args', () => {
		const decision = shouldBlock(
			'something_delegate_only',
			{ delegate: true },
			{ something_delegate_only: 'delegate-only' }
		);
		expect( decision.block ).toBe( true );
		expect( decision.reason ).toMatch( /not invoke/i );
	} );
} );

describe( 'createDlaPolicyFactory', () => {
	it( 'registers a tool_call handler that defers to shouldBlock', async () => {
		const handlers = new Map< string, ( event: unknown ) => unknown | Promise< unknown > >();
		const pi = {
			on: vi.fn(
				(
					eventName: string,
					handler: typeof handlers extends Map< string, infer V > ? V : never
				) => {
					handlers.set( eventName, handler );
				}
			),
		};

		const factory = createDlaPolicyFactory();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural mock for the test
		await factory( pi as any );

		expect( pi.on ).toHaveBeenCalledWith( 'tool_call', expect.any( Function ) );

		const handler = handlers.get( 'tool_call' )!;
		const blocked = await handler( {
			type: 'tool_call',
			toolName: 'liberate_import',
			toolCallId: '1',
			input: { delegate: false },
		} );
		expect( blocked ).toMatchObject( { block: true } );

		const allowed = await handler( {
			type: 'tool_call',
			toolName: 'liberate_inspect',
			toolCallId: '2',
			input: { url: 'https://example.com' },
		} );
		expect( allowed ).toBeUndefined();
	} );

	it( 'ignores tool_call events for non-DLA tools', async () => {
		const handlers = new Map< string, ( event: unknown ) => unknown | Promise< unknown > >();
		const pi = {
			on: vi.fn(
				(
					eventName: string,
					handler: typeof handlers extends Map< string, infer V > ? V : never
				) => {
					handlers.set( eventName, handler );
				}
			),
		};

		const factory = createDlaPolicyFactory();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural mock for the test
		await factory( pi as any );

		const handler = handlers.get( 'tool_call' )!;
		const result = await handler( {
			type: 'tool_call',
			toolName: 'bash',
			toolCallId: '3',
			input: { command: 'echo hi' },
		} );
		expect( result ).toBeUndefined();
	} );
} );
