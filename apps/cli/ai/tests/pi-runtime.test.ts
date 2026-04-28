import { describe, expect, it, vi } from 'vitest';
import { piRuntime } from 'cli/ai/runtimes/pi';
import type { AiModelId } from '@studio/common/ai/models';

// Module-level capture so the model-swap test can inspect every Agent the
// runtime instantiated across a sequence of `run()` calls.
const constructedAgents: Array< {
	options: {
		getApiKey?: () => string;
		initialState?: {
			model?: { id?: string; api?: string; provider?: string; headers?: Record< string, string > };
			messages?: unknown[];
		};
	};
	state: {
		model: { id: string; api: string; provider: string; headers?: Record< string, string > };
		messages: unknown[];
	};
} > = [];

// Tests can override the events the mock Agent emits per prompt(), to
// simulate weird model behavior (e.g. thinking-only turns) without
// re-mocking the whole module.
const DEFAULT_MOCK_EVENTS: unknown[] = [
	{
		type: 'message_end',
		message: {
			role: 'assistant',
			content: [ { type: 'text', text: 'mocked response' } ],
		},
	},
	{ type: 'turn_end', toolResults: [] },
	{ type: 'agent_end', messages: [] },
];
let nextMockEvents: unknown[] | null = null;

vi.mock( '@mariozechner/pi-agent-core', () => {
	class MockAgent {
		private listener?: ( event: unknown ) => void;
		public state: {
			model: { id: string; api: string; provider: string; headers?: Record< string, string > };
			messages: unknown[];
		};
		constructor(
			public options: {
				getApiKey?: () => string;
				initialState?: {
					model?: {
						id?: string;
						api?: string;
						provider?: string;
						headers?: Record< string, string >;
					};
					messages?: unknown[];
				};
			}
		) {
			this.state = {
				model: {
					id: options.initialState?.model?.id ?? '',
					api: options.initialState?.model?.api ?? '',
					provider: options.initialState?.model?.provider ?? '',
					headers: options.initialState?.model?.headers,
				},
				messages: options.initialState?.messages?.slice() ?? [],
			};
			constructedAgents.push( this );
		}
		subscribe( listener: ( event: unknown ) => void ): () => void {
			this.listener = listener;
			return () => {};
		}
		async prompt( _text: string ): Promise< void > {
			const events = nextMockEvents ?? DEFAULT_MOCK_EVENTS;
			nextMockEvents = null;
			for ( const event of events ) {
				this.listener?.( event );
			}
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
		shouldCompact: () => false,
		generateSummary: async () => '',
		estimateTokens: () => 0,
	};
} );

describe( 'unified pi runtime', () => {
	it( 'yields an error when OPENAI_API_KEY is absent for an OpenAI model', async () => {
		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {},
			model: 'gpt-5.5',
			maxTurns: 1,
		} );

		const messages: Array< { type: string; subtype?: string } > = [];
		for await ( const m of handle ) {
			messages.push( { type: m.type, subtype: 'subtype' in m ? m.subtype : undefined } );
		}

		expect( messages ).toEqual( [
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', subtype: undefined },
			{ type: 'result', subtype: 'error_during_execution' },
		] );
	} );

	it( 'yields an error when no Anthropic auth is set for a Claude model', async () => {
		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {},
			model: 'claude-sonnet-4-6',
			maxTurns: 1,
		} );

		const messages: Array< { type: string; subtype?: string } > = [];
		for await ( const m of handle ) {
			messages.push( { type: m.type, subtype: 'subtype' in m ? m.subtype : undefined } );
		}

		expect( messages ).toEqual( [
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', subtype: undefined },
			{ type: 'result', subtype: 'error_during_execution' },
		] );
	} );

	it( 'yields a full exchange when the mocked Agent returns output (OpenAI dispatch)', async () => {
		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			maxTurns: 1,
		} );

		const messages: Array< {
			type: string;
			subtype?: string;
			text?: string;
		} > = [];
		for await ( const m of handle ) {
			if ( m.type === 'assistant' ) {
				const content = m.message.content;
				const firstText = Array.isArray( content )
					? content.find( ( c ) => 'text' in c )
					: undefined;
				messages.push( {
					type: m.type,
					text: firstText && 'text' in firstText ? firstText.text : undefined,
				} );
			} else {
				messages.push( {
					type: m.type,
					subtype: 'subtype' in m ? m.subtype : undefined,
				} );
			}
		}

		expect( messages ).toEqual( [
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', text: 'mocked response' },
			{ type: 'result', subtype: 'success' },
		] );
	} );

	it( 'builds an anthropic-messages Model when dispatching a Claude model', async () => {
		constructedAgents.length = 0;
		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'sk-test',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
				ANTHROPIC_CUSTOM_HEADERS: 'X-WPCOM-AI-Feature: studio-assistant-anthropic',
			},
			model: 'claude-opus-4-7',
			maxTurns: 1,
		} );

		for await ( const _ of handle ) {
			// Drain.
		}

		expect( constructedAgents ).toHaveLength( 1 );
		expect( constructedAgents[ 0 ].state.model.api ).toBe( 'anthropic-messages' );
		expect( constructedAgents[ 0 ].state.model.provider ).toBe( 'anthropic' );
		expect( constructedAgents[ 0 ].state.model.id ).toBe( 'claude-opus-4-7' );
		expect( constructedAgents[ 0 ].state.model.headers ).toMatchObject( {
			Authorization: 'Bearer sk-test',
			'X-WPCOM-AI-Feature': 'studio-assistant-anthropic',
		} );
		expect( constructedAgents[ 0 ].options.getApiKey?.() ).toBe( 'sk-test' );
	} );

	it( 'surfaces assistant text carried by turn_end.message', async () => {
		nextMockEvents = [
			{
				type: 'turn_end',
				message: {
					role: 'assistant',
					content: [ { type: 'text', text: 'turn end response' } ],
					stopReason: 'stop',
				},
				toolResults: [],
			},
			{ type: 'agent_end', messages: [] },
		];

		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'sk-test',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
			},
			model: 'claude-sonnet-4-6',
			maxTurns: 1,
			resume: 'turn-end-message-' + Math.random(),
		} );

		const assistantTexts: string[] = [];
		for await ( const m of handle ) {
			if ( m.type === 'assistant' && Array.isArray( m.message.content ) ) {
				const content = m.message.content as Array< { type: string; text?: string } >;
				const text = content.find(
					( block ): block is { type: 'text'; text: string } => block.type === 'text'
				);
				if ( text ) assistantTexts.push( text.text );
			}
		}

		expect( assistantTexts ).toEqual( [ 'turn end response' ] );
	} );

	it( 'dedupes assistant messages repeated by message_end and turn_end.message', async () => {
		const repeatedMessage = {
			role: 'assistant',
			content: [ { type: 'text', text: 'same response' } ],
			stopReason: 'stop',
		};
		nextMockEvents = [
			{ type: 'message_end', message: repeatedMessage },
			{ type: 'turn_end', message: repeatedMessage, toolResults: [] },
			{ type: 'agent_end', messages: [] },
		];

		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'sk-test',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
			},
			model: 'claude-sonnet-4-6',
			maxTurns: 1,
			resume: 'dedupe-' + Math.random(),
		} );

		let assistantCount = 0;
		for await ( const m of handle ) {
			if ( m.type === 'assistant' ) assistantCount += 1;
		}

		expect( assistantCount ).toBe( 1 );
	} );

	it( 'streams tool calls and results from execution events without turn_end duplicates', async () => {
		const toolMessage = {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'tool-1',
					name: 'site_info',
					arguments: { nameOrPath: 'intelligence-chubes4' },
				},
			],
			stopReason: 'toolCall',
		};
		nextMockEvents = [
			{
				type: 'tool_execution_start',
				toolCallId: 'tool-1',
				toolName: 'site_info',
				args: { nameOrPath: 'intelligence-chubes4' },
			},
			{
				type: 'tool_execution_end',
				toolCallId: 'tool-1',
				toolName: 'site_info',
				args: { nameOrPath: 'intelligence-chubes4' },
				result: { content: [ { type: 'text', text: '{"status":"Offline"}' } ] },
				isError: false,
			},
			{
				type: 'turn_end',
				message: toolMessage,
				toolResults: [
					{
						toolCallId: 'tool-1',
						toolName: 'site_info',
						content: [ { type: 'text', text: '{"status":"Offline"}' } ],
						isError: false,
					},
				],
			},
			{ type: 'agent_end', messages: [] },
		];

		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'sk-test',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
			},
			model: 'claude-sonnet-4-6',
			maxTurns: 1,
			resume: 'stream-tool-events-' + Math.random(),
		} );

		const toolCalls: Array< { id: string; name: string; input: unknown } > = [];
		const toolResults: Array< { id: string; text: string; isError: boolean } > = [];
		for await ( const m of handle ) {
			if ( m.type === 'assistant' && Array.isArray( m.message.content ) ) {
				for ( const block of m.message.content ) {
					if ( block.type === 'tool_use' ) {
						toolCalls.push( { id: block.id, name: block.name, input: block.input } );
					}
				}
			}
			if ( m.type === 'user' && Array.isArray( m.message.content ) ) {
				for ( const block of m.message.content ) {
					if ( block.type === 'tool_result' ) {
						toolResults.push( {
							id: block.tool_use_id,
							text: block.content,
							isError: block.is_error,
						} );
					}
				}
			}
		}

		expect( toolCalls ).toEqual( [
			{ id: 'tool-1', name: 'site_info', input: { nameOrPath: 'intelligence-chubes4' } },
		] );
		expect( toolResults ).toEqual( [
			{ id: 'tool-1', text: '{"status":"Offline"}', isError: false },
		] );
	} );

	it( 'treats pi assistant error stop reasons as failed results', async () => {
		nextMockEvents = [
			{
				type: 'turn_end',
				message: {
					role: 'assistant',
					content: [ { type: 'text', text: 'provider failed' } ],
					stopReason: 'error',
				},
				toolResults: [],
			},
			{ type: 'agent_end', messages: [] },
		];

		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'sk-test',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
			},
			model: 'claude-sonnet-4-6',
			maxTurns: 1,
			resume: 'error-stop-' + Math.random(),
		} );

		const messages: Array< { type: string; subtype?: string; text?: string } > = [];
		for await ( const m of handle ) {
			if ( m.type === 'assistant' && Array.isArray( m.message.content ) ) {
				const content = m.message.content as Array< { type: string; text?: string } >;
				const text = content.find(
					( block ): block is { type: 'text'; text: string } => block.type === 'text'
				);
				messages.push( { type: m.type, text: text?.text } );
			} else {
				messages.push( { type: m.type, subtype: 'subtype' in m ? m.subtype : undefined } );
			}
		}

		expect( messages ).toEqual( [
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', text: 'provider failed' },
			{ type: 'result', subtype: 'error_during_execution' },
		] );
	} );

	// Regression: with reasoning enabled, models occasionally produce a turn
	// whose only content is `thinking` blocks — no text, no tool calls. The
	// unified runtime promotes thinking blocks into proper `thinking` content
	// blocks on the synthetic SDKMessage so the desktop UI's "Claude is
	// thinking" affordance keeps working. Empty turns are silently skipped —
	// the result message still closes the turn.
	it( 'surfaces thinking blocks as their own assistant SDKMessages', async () => {
		nextMockEvents = [
			{
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [ { type: 'thinking', thinking: 'reasoned through it' } ],
				},
			},
			{ type: 'turn_end', toolResults: [] },
			{ type: 'agent_end', messages: [] },
		];

		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			maxTurns: 1,
			resume: 'thinking-only-' + Math.random(),
		} );

		const thinkingTexts: string[] = [];
		for await ( const m of handle ) {
			if ( m.type === 'assistant' ) {
				const content = m.message.content;
				if ( Array.isArray( content ) ) {
					for ( const block of content ) {
						if (
							block &&
							typeof block === 'object' &&
							'type' in block &&
							block.type === 'thinking'
						) {
							thinkingTexts.push( ( block as { thinking?: string } ).thinking ?? '' );
						}
					}
				}
			}
		}

		expect( thinkingTexts ).toEqual( [ 'reasoned through it' ] );
	} );

	// Regression: in CLI interactive mode the runtime kept a single Agent per
	// session forever. Switching models with `/model` flipped the dropdown
	// without rebuilding the Agent, so the new model id never reached the
	// next request. The fix: when the cached Agent's model differs from the
	// new request, rebuild the Agent (preserving messages so conversation
	// continues).
	//
	// We use a synthetic second model id (cast to AiModelId) so the test
	// covers the cache logic independent of which models AI_MODELS happens
	// to expose at any point in time.
	it( 'rebuilds the Agent when the model changes mid-session', async () => {
		constructedAgents.length = 0;
		const env = {
			OPENAI_API_KEY: 'sk-test',
			OPENAI_BASE_URL: 'https://proxy.example.com/v1',
		};
		const sessionId = 'fixed-session-id-for-swap-test';
		const otherOpenAiModel = 'gpt-test-other' as AiModelId;

		// First turn on gpt-5.5.
		const first = piRuntime.run( {
			prompt: 'hi',
			env,
			model: 'gpt-5.5',
			maxTurns: 1,
			resume: sessionId,
		} );

		for await ( const _ of first ) {
			// Drain.
		}
		expect( constructedAgents ).toHaveLength( 1 );
		expect( constructedAgents[ 0 ].state.model.id ).toBe( 'gpt-5.5' );

		// Second turn on the same session id but a different model — this
		// is the `/model` swap. The cache must NOT win here.
		const second = piRuntime.run( {
			prompt: 'follow-up',
			env,
			model: otherOpenAiModel,
			maxTurns: 1,
			resume: sessionId,
		} );

		for await ( const _ of second ) {
			// Drain.
		}
		expect( constructedAgents ).toHaveLength( 2 );
		expect( constructedAgents[ 1 ].state.model.id ).toBe( otherOpenAiModel );

		// Third turn on the same model — should hit the cache, not rebuild.
		const third = piRuntime.run( {
			prompt: 'still on the second model',
			env,
			model: otherOpenAiModel,
			maxTurns: 1,
			resume: sessionId,
		} );

		for await ( const _ of third ) {
			// Drain.
		}
		expect( constructedAgents ).toHaveLength( 2 );
	} );
} );
