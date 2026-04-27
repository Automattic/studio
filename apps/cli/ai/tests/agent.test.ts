import fs from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { startAiAgent } from 'cli/ai/agent';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

vi.mock( '@anthropic-ai/claude-agent-sdk', () => ( {
	query: vi.fn(),
	tool: vi.fn().mockImplementation( ( name, description, inputSchema, handler ) => ( {
		name,
		description,
		inputSchema,
		handler,
	} ) ),
	createSdkMcpServer: vi.fn().mockReturnValue( { instance: {} } ),
} ) );

vi.mock( 'cli/ai/system-prompt', () => ( {
	buildSystemPrompt: vi.fn().mockReturnValue( 'test system prompt' ),
} ) );

vi.mock( 'cli/ai/tools', () => ( {
	createRemoteSiteTools: vi.fn().mockReturnValue( { type: 'remote-tools' } ),
	createStudioTools: vi.fn().mockReturnValue( { type: 'local-tools' } ),
	studioToolDefinitions: [],
} ) );

vi.mock( '@mariozechner/pi-agent-core', () => {
	class MockAgent {
		private listener?: ( event: unknown ) => void;
		constructor( public options: unknown ) {}
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
	};
} );

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

	it( 'routes GPT models to the OpenAI runtime regardless of env credentials', async () => {
		const handle = startAiAgent( {
			prompt: 'hi',
			model: 'gpt-5.5',
			env: {
				ANTHROPIC_API_KEY: 'sk-ant',
				OPENAI_API_KEY: 'sk-oai',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
		} );

		// The OpenAI runtime is self-contained and does not touch the mocked
		// Claude Agent SDK's query() function.
		expect( query ).not.toHaveBeenCalled();

		// Drain the stream so the runtime's internal generator settles.
		const messages: string[] = [];
		for await ( const m of handle ) {
			messages.push( m.type );
		}
		expect( messages ).toEqual( expect.arrayContaining( [ 'system', 'result' ] ) );
	} );

	it( 'routes Claude models to the Anthropic runtime even when OPENAI_API_KEY is set', () => {
		startAiAgent( {
			prompt: 'hi',
			model: 'claude-sonnet-4-6',
			env: { OPENAI_API_KEY: 'sk-oai' },
		} );

		expect( query ).toHaveBeenCalled();
	} );
} );
