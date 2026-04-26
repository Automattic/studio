import fs from 'fs';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { startAiAgent } from 'cli/ai/agent';
import { STUDIO_ROOT } from 'cli/ai/security';

// Module-level capture so the cross-family dispatch test can inspect every
// Agent the runtime instantiated, including the api/provider it was built
// against.
const constructedAgents: Array< {
	state: { model: { id: string; api: string; provider: string } };
} > = [];

vi.mock( 'cli/ai/system-prompt', () => ( {
	buildSystemPrompt: vi.fn().mockReturnValue( 'test system prompt' ),
} ) );

vi.mock( 'cli/ai/tools', () => ( {
	studioToolDefinitions: [],
} ) );

vi.mock( '@mariozechner/pi-agent-core', () => {
	class MockAgent {
		private listener?: ( event: unknown ) => void;
		public state: { model: { id: string; api: string; provider: string }; messages: unknown[] };
		constructor(
			public options: {
				initialState?: {
					model?: { id?: string; api?: string; provider?: string };
					messages?: unknown[];
				};
			}
		) {
			this.state = {
				model: {
					id: options.initialState?.model?.id ?? '',
					api: options.initialState?.model?.api ?? '',
					provider: options.initialState?.model?.provider ?? '',
				},
				messages: options.initialState?.messages?.slice() ?? [],
			};
			constructedAgents.push( this );
		}
		subscribe( listener: ( event: unknown ) => void ): () => void {
			this.listener = listener;
			return () => {};
		}
		async prompt(): Promise< void > {
			this.listener?.( {
				type: 'message_end',
				message: { role: 'assistant', content: [ { type: 'text', text: 'mocked' } ] },
			} );
			this.listener?.( { type: 'turn_end', toolResults: [] } );
			this.listener?.( { type: 'agent_end', messages: [] } );
		}
		abort(): void {}
	}
	return { Agent: MockAgent };
} );

vi.mock( '@mariozechner/pi-coding-agent', () => {
	const stub = ( name: string ) => ( {
		name,
		label: name,
		description: name,
		parameters: {},
		execute: async () => ( { content: [ { type: 'text', text: '' } ], details: undefined } ),
	} );
	return {
		createReadTool: () => stub( 'Read' ),
		createWriteTool: () => stub( 'Write' ),
		createEditTool: () => stub( 'Edit' ),
		createBashTool: () => stub( 'Bash' ),
		createGrepTool: () => stub( 'Grep' ),
		createFindTool: () => stub( 'Glob' ),
		createLsTool: () => stub( 'Ls' ),
		// Compaction helpers are imported by `runtimes/pi/compaction.ts`. Stub
		// them to no-ops so we don't pull in the real implementations under test.
		shouldCompact: () => false,
		generateSummary: async () => '',
		estimateTokens: () => 0,
	};
} );

describe( 'AI agent startup', () => {
	let existsSyncSpy: MockInstance;
	let mkdirSyncSpy: MockInstance;

	beforeEach( () => {
		constructedAgents.length = 0;
		vi.clearAllMocks();
		existsSyncSpy = vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		mkdirSyncSpy = vi.spyOn( fs, 'mkdirSync' ).mockReturnValue( undefined );
	} );

	it( 'creates the Studio root before starting the agent when it is missing', async () => {
		existsSyncSpy.mockReturnValue( false );

		const handle = startAiAgent( {
			prompt: 'Generate a website',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'sk-test',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
			},
		} );

		expect( existsSyncSpy ).toHaveBeenCalledWith( STUDIO_ROOT );
		expect( mkdirSyncSpy ).toHaveBeenCalledWith( STUDIO_ROOT, { recursive: true } );

		// Drain the stream so the runtime's internal generator settles, ensuring
		// we test the full dispatch path rather than the eager part.
		for await ( const _ of handle ) {
			// Noop.
		}
	} );

	it( 'does not recreate the Studio root when it already exists', async () => {
		const handle = startAiAgent( {
			prompt: 'Generate a website',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'sk-test',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
			},
		} );

		expect( existsSyncSpy ).toHaveBeenCalledWith( STUDIO_ROOT );
		expect( mkdirSyncSpy ).not.toHaveBeenCalled();

		for await ( const _ of handle ) {
			// Drain.
		}
	} );

	it( 'routes GPT models to an openai-completions Model build', async () => {
		const handle = startAiAgent( {
			prompt: 'hi',
			model: 'gpt-5.5',
			env: {
				OPENAI_API_KEY: 'sk-oai',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
		} );

		const messages: string[] = [];
		for await ( const m of handle ) {
			messages.push( m.type );
		}
		expect( messages ).toEqual( expect.arrayContaining( [ 'system', 'result' ] ) );
		expect( constructedAgents ).toHaveLength( 1 );
		expect( constructedAgents[ 0 ].state.model.api ).toBe( 'openai-completions' );
		expect( constructedAgents[ 0 ].state.model.provider ).toBe( 'openai' );
	} );

	it( 'routes Claude models to an anthropic-messages Model build', async () => {
		const handle = startAiAgent( {
			prompt: 'hi',
			model: 'claude-sonnet-4-6',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'sk-test',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
			},
		} );

		const messages: string[] = [];
		for await ( const m of handle ) {
			messages.push( m.type );
		}
		expect( messages ).toEqual( expect.arrayContaining( [ 'system', 'result' ] ) );
		expect( constructedAgents ).toHaveLength( 1 );
		expect( constructedAgents[ 0 ].state.model.api ).toBe( 'anthropic-messages' );
		expect( constructedAgents[ 0 ].state.model.provider ).toBe( 'anthropic' );
	} );
} );
