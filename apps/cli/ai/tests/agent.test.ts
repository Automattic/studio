import fs from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { startAiAgent } from 'cli/ai/agent';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

vi.mock( '@anthropic-ai/claude-agent-sdk', () => ( {
	query: vi.fn(),
} ) );

vi.mock( 'cli/ai/system-prompt', () => ( {
	buildSystemPrompt: vi.fn().mockReturnValue( 'test system prompt' ),
} ) );

vi.mock( 'cli/ai/tools', () => ( {
	createRemoteSiteTools: vi.fn().mockReturnValue( { type: 'remote-tools' } ),
	createStudioTools: vi.fn().mockReturnValue( { type: 'local-tools' } ),
} ) );

describe( 'AI agent startup', () => {
	const mockQuery = {
		interrupt: vi.fn(),
		[ Symbol.asyncIterator ]() {
			return {
				next: async () => ( {
					done: true as const,
					value: undefined,
				} ),
			};
		},
	};
	let existsSyncSpy: MockInstance;
	let mkdirSyncSpy: MockInstance;

	beforeEach( () => {
		vi.resetAllMocks();
		existsSyncSpy = vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		mkdirSyncSpy = vi.spyOn( fs, 'mkdirSync' ).mockReturnValue( undefined );
		vi.mocked( query ).mockReturnValue( mockQuery as never );
	} );

	it( 'creates the Studio root before starting the agent when it is missing', () => {
		existsSyncSpy.mockReturnValue( false );

		const result = startAiAgent( {
			prompt: 'Generate a website',
		} );

		expect( existsSyncSpy ).toHaveBeenCalledWith( STUDIO_SITES_ROOT );
		expect( mkdirSyncSpy ).toHaveBeenCalledWith( STUDIO_SITES_ROOT, { recursive: true } );
		expect( query ).toHaveBeenCalledWith(
			expect.objectContaining( {
				prompt: 'Generate a website',
				options: expect.objectContaining( {
					cwd: STUDIO_SITES_ROOT,
				} ),
			} )
		);
		expect( result ).toBe( mockQuery );
	} );

	it( 'does not recreate the Studio root when it already exists', () => {
		const result = startAiAgent( {
			prompt: 'Generate a website',
		} );

		expect( existsSyncSpy ).toHaveBeenCalledWith( STUDIO_SITES_ROOT );
		expect( mkdirSyncSpy ).not.toHaveBeenCalled();
		expect( query ).toHaveBeenCalledWith(
			expect.objectContaining( {
				prompt: 'Generate a website',
				options: expect.objectContaining( {
					cwd: STUDIO_SITES_ROOT,
				} ),
			} )
		);
		expect( result ).toBe( mockQuery );
	} );

	describe( 'permission hooks', () => {
		function getPreToolUseHooks() {
			const callArgs = vi.mocked( query ).mock.calls[ 0 ][ 0 ];
			return callArgs.options?.hooks?.PreToolUse ?? [];
		}

		it( 'pre-approves mcp__studio__ tools so a classifier outage cannot block them', async () => {
			startAiAgent( { prompt: 'noop' } );

			const studioMatcher = getPreToolUseHooks().find( ( m ) => m.matcher === '^mcp__studio__' );
			expect( studioMatcher ).toBeDefined();

			const result = await studioMatcher!.hooks[ 0 ](
				{
					hook_event_name: 'PreToolUse',
					tool_name: 'mcp__studio__site_info',
					tool_input: {},
					tool_use_id: 'use-1',
				} as never,
				'use-1',
				{ signal: new AbortController().signal }
			);
			expect( result ).toEqual( {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'allow',
				},
			} );
		} );

		it( 'registers the studio pre-approval hook even when onAskUser is not provided', () => {
			startAiAgent( { prompt: 'noop' } );

			const matchers = getPreToolUseHooks().map( ( m ) => m.matcher );
			expect( matchers ).toEqual( [ '^mcp__studio__' ] );
		} );

		it( 'keeps the AskUserQuestion hook alongside the studio pre-approval', () => {
			startAiAgent( { prompt: 'noop', onAskUser: async () => ( {} ) } );

			const matchers = getPreToolUseHooks().map( ( m ) => m.matcher );
			expect( matchers ).toEqual( [ '^mcp__studio__', 'AskUserQuestion' ] );
		} );
	} );
} );
