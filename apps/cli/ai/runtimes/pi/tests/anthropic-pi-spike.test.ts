// Live integration: hit the wpcom proxy with a real Anthropic model and
// confirm a tool call round-trips. Skipped unless `STUDIO_LIVE_SPIKE=1` and
// either `studio auth login` was run or `STUDIO_WPCOM_TOKEN` is set.

import Anthropic from '@anthropic-ai/sdk';
import { Agent, type AgentEvent, type AgentTool, type StreamFn } from '@mariozechner/pi-agent-core';
import { Type, type Model } from '@mariozechner/pi-ai';
import { streamAnthropic, type AnthropicOptions } from '@mariozechner/pi-ai/anthropic';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { describe, expect, it } from 'vitest';

const ENABLED = process.env.STUDIO_LIVE_SPIKE === '1';
const WPCOM_BASE_URL =
	process.env.WPCOM_AI_PROXY_BASE_URL?.trim() ||
	'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
const FEATURE_HEADER = 'studio-assistant-anthropic';
const SPIKE_TOKEN_PROBE = 'spike-ok';
const MODEL_ID = 'claude-sonnet-4-6';

async function resolveWpcomToken(): Promise< string > {
	const inline = process.env.STUDIO_WPCOM_TOKEN?.trim();
	if ( inline ) return inline;
	const token = await readAuthToken();
	if ( ! token ) {
		throw new Error(
			'Spike needs a wpcom token. Run `studio auth login` first, or set STUDIO_WPCOM_TOKEN.'
		);
	}
	return token.accessToken;
}

describe( 'pi-ai Anthropic over wpcom proxy (spike)', () => {
	it.skipIf( ! ENABLED )(
		'round-trips a tool call and finishes the turn',
		async () => {
			const accessToken = await resolveWpcomToken();

			// Pre-built Anthropic client with Bearer auth — pi-ai's default
			// path uses x-api-key, which the wpcom proxy rejects.
			const anthropicClient = new Anthropic( {
				apiKey: null,
				authToken: accessToken,
				baseURL: WPCOM_BASE_URL,
				dangerouslyAllowBrowser: true,
				defaultHeaders: {
					'X-WPCOM-AI-Feature': FEATURE_HEADER,
				},
			} );

			const model: Model< 'anthropic-messages' > = {
				id: MODEL_ID,
				name: MODEL_ID,
				api: 'anthropic-messages',
				provider: 'anthropic',
				baseUrl: WPCOM_BASE_URL,
				reasoning: false,
				input: [ 'text' ],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 4_096,
			};

			let echoCalls = 0;
			let echoArg = '';
			const echoTool: AgentTool< ReturnType< typeof Type.Object > > = {
				name: 'echo',
				description:
					'Echo the input text back verbatim. Used by the integration spike to verify a round-trip.',
				parameters: Type.Object( { text: Type.String() } ),
				label: 'echo',
				execute: async ( _toolCallId, params ) => {
					echoCalls += 1;
					echoArg = ( params as { text: string } ).text;
					return {
						content: [ { type: 'text', text: echoArg } ],
						details: undefined,
					};
				},
			};

			// pi-ai bundles its own `@anthropic-ai/sdk`; cast around the
			// duplicated TS identity (runtime shape is identical).
			const clientForPi = anthropicClient as unknown as AnthropicOptions[ 'client' ];

			const customStreamFn: StreamFn = ( m, ctx, options ) =>
				streamAnthropic( m as Model< 'anthropic-messages' >, ctx, {
					...( options as AnthropicOptions | undefined ),
					client: clientForPi,
				} );

			const agent = new Agent( {
				initialState: {
					model,
					systemPrompt:
						'You are a tool-calling test harness. When asked to use a tool, call it directly with the requested arguments. Do not ask follow-up questions.',
					messages: [],
					tools: [ echoTool ],
				},
				streamFn: customStreamFn,
			} );

			const events: AgentEvent[] = [];
			const unsubscribe = agent.subscribe( ( event ) => {
				events.push( event );
			} );

			try {
				await agent.prompt(
					`Use the \`echo\` tool to echo the exact string ${ JSON.stringify(
						SPIKE_TOKEN_PROBE
					) }. After the tool result, reply with the single word "done".`
				);
			} finally {
				unsubscribe();
			}

			const toolStarts = events.filter(
				( e ): e is Extract< AgentEvent, { type: 'tool_execution_start' } > =>
					e.type === 'tool_execution_start'
			);
			const toolEnds = events.filter(
				( e ): e is Extract< AgentEvent, { type: 'tool_execution_end' } > =>
					e.type === 'tool_execution_end'
			);
			const agentEnds = events.filter( ( e ) => e.type === 'agent_end' );

			expect( toolStarts.map( ( e ) => e.toolName ) ).toContain( 'echo' );
			expect( toolEnds.find( ( e ) => e.toolName === 'echo' )?.isError ).toBe( false );
			expect( echoCalls ).toBeGreaterThanOrEqual( 1 );
			expect( echoArg ).toBe( SPIKE_TOKEN_PROBE );
			expect( agentEnds.length ).toBe( 1 );
		},
		120_000
	);
} );
