// Live integration: hit the wpcom proxy through pi AgentSession with a custom
// bearer-auth Anthropic provider and confirm a tool call round-trips. Skipped
// unless `STUDIO_LIVE_SPIKE=1` and either `studio auth login` was run or
// `STUDIO_WPCOM_TOKEN` is set.

import Anthropic from '@anthropic-ai/sdk';
import { Type, type Model, type SimpleStreamOptions } from '@mariozechner/pi-ai';
import { streamAnthropic, type AnthropicOptions } from '@mariozechner/pi-ai/anthropic';
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type AgentSessionEvent,
	type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { describe, expect, it } from 'vitest';

const ENABLED = process.env.STUDIO_LIVE_SPIKE === '1';
const WPCOM_BASE_URL =
	process.env.WPCOM_AI_PROXY_BASE_URL?.trim() ||
	'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
const PROVIDER_ID = 'studio-wpcom-anthropic-spike';
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

describe( 'AgentSession Anthropic over wpcom proxy (spike)', () => {
	it.skipIf( ! ENABLED )(
		'round-trips a tool call and finishes the turn',
		async () => {
			const accessToken = await resolveWpcomToken();
			const authStorage = AuthStorage.inMemory();
			const modelRegistry = ModelRegistry.inMemory( authStorage );
			modelRegistry.registerProvider( PROVIDER_ID, {
				baseUrl: WPCOM_BASE_URL,
				apiKey: accessToken,
				api: 'anthropic-messages',
				headers: {
					'X-WPCOM-AI-Feature': FEATURE_HEADER,
				},
				streamSimple: ( model, ctx, options?: SimpleStreamOptions ) => {
					const anthropicClient = new Anthropic( {
						apiKey: null,
						authToken: options?.apiKey ?? accessToken,
						baseURL: model.baseUrl,
						dangerouslyAllowBrowser: true,
						defaultHeaders: options?.headers,
					} );
					const clientForPi = anthropicClient as unknown as AnthropicOptions[ 'client' ];
					return streamAnthropic( model as Model< 'anthropic-messages' >, ctx, {
						...( options as AnthropicOptions | undefined ),
						client: clientForPi,
					} );
				},
				models: [
					{
						id: MODEL_ID,
						name: MODEL_ID,
						api: 'anthropic-messages',
						baseUrl: WPCOM_BASE_URL,
						reasoning: false,
						input: [ 'text' ],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 200_000,
						maxTokens: 4_096,
					},
				],
			} );
			const model = modelRegistry.find( PROVIDER_ID, MODEL_ID );
			if ( ! model ) {
				throw new Error( 'Spike model was not registered.' );
			}

			let echoCalls = 0;
			let echoArg = '';
			const echoTool: ToolDefinition< ReturnType< typeof Type.Object > > = {
				name: 'echo',
				label: 'echo',
				description:
					'Echo the input text back verbatim. Used by the integration spike to verify a round-trip.',
				parameters: Type.Object( { text: Type.String() } ),
				execute: async ( _toolCallId, params ) => {
					echoCalls += 1;
					echoArg = ( params as { text: string } ).text;
					return {
						content: [ { type: 'text', text: echoArg } ],
						details: undefined,
					};
				},
			};

			const settingsManager = SettingsManager.inMemory( {
				compaction: { enabled: false },
				retry: { provider: { maxRetries: 0 } },
			} );
			const resourceLoader = new DefaultResourceLoader( {
				cwd: process.cwd(),
				agentDir: process.cwd(),
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				systemPrompt:
					'You are a tool-calling test harness. When asked to use a tool, call it directly with the requested arguments. Do not ask follow-up questions.',
			} );
			await resourceLoader.reload();
			const { session } = await createAgentSession( {
				cwd: process.cwd(),
				agentDir: process.cwd(),
				authStorage,
				modelRegistry,
				model,
				thinkingLevel: 'off',
				sessionManager: SessionManager.inMemory( process.cwd() ),
				settingsManager,
				resourceLoader,
				customTools: [ echoTool ],
				tools: [ echoTool.name ],
			} );

			const events: AgentSessionEvent[] = [];
			const unsubscribe = session.subscribe( ( event ) => {
				events.push( event );
			} );

			try {
				await session.prompt(
					`Use the \`echo\` tool to echo the exact string ${ JSON.stringify(
						SPIKE_TOKEN_PROBE
					) }. After the tool result, reply with the single word "done".`,
					{ expandPromptTemplates: false, source: 'rpc' }
				);
			} finally {
				unsubscribe();
				session.dispose();
			}

			const toolStarts = events.filter(
				( e ): e is Extract< AgentSessionEvent, { type: 'tool_execution_start' } > =>
					e.type === 'tool_execution_start'
			);
			const toolEnds = events.filter(
				( e ): e is Extract< AgentSessionEvent, { type: 'tool_execution_end' } > =>
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
