import Anthropic from '@anthropic-ai/sdk';
import { discoverSiteSkills, buildSkillsPromptXml } from 'src/modules/agent-skills/main';
import { loadUserData } from 'src/storage/user-data';
import { getApiKey } from './api-key-storage';
import { executeTool, getToolDefinitions } from './tool-executor';
import type { AgentMessage, ToolCall, ToolResultMessage, ServerEvent } from '../types';
import type { Response } from 'express';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const MAX_TOOL_ITERATIONS = 10;

const SYSTEM_PROMPT = `I am Studio Assistant, an AI assistant for WordPress Studio, a local WordPress development environment.

I help users manage their WordPress sites, run WP-CLI commands, explore files, and troubleshoot issues.

Available capabilities:
- Execute WP-CLI commands to manage plugins, themes, users, posts, and settings
- Create, start, stop, and delete WordPress sites
- Browse site file trees and understand the codebase
- Get theme information and check if it's a block theme
- Validate WordPress Playground Blueprint configurations
- Update site settings like PHP version, custom domains, and HTTPS
- Search WordPress documentation for help articles

Guidelines:
1. Be concise but thorough in your explanations
2. When executing WP-CLI commands, explain what you're doing and why
3. If a command fails, explain the error and suggest solutions
4. When exploring files, summarize what you find
5. Always confirm destructive operations before executing them
6. If you're unsure about something, ask for clarification

Remember: You're helping developers work with their local WordPress sites. Focus on being practical and helpful.`;

interface ConversationMessage {
	role: 'user' | 'assistant';
	content: string | Anthropic.ContentBlockParam[];
}

/**
 * Send a Server-Sent Event to the response stream.
 */
function sendSSE( res: Response, event: ServerEvent ): void {
	res.write( `data: ${ JSON.stringify( event ) }\n\n` );
}

/**
 * Content block for tracking interleaved text and tool calls.
 */
interface ContentBlockTracker {
	index: number;
	type: 'text' | 'tool_use';
	text?: string;
	toolId?: string;
	toolName?: string;
	toolInput?: string;
}

/**
 * Create an Anthropic client with the stored API key.
 */
async function createClient(): Promise< Anthropic | null > {
	const apiKey = await getApiKey();
	if ( ! apiKey ) {
		return null;
	}
	return new Anthropic( { apiKey } );
}

/**
 * Get the site path for a site ID from user data.
 */
async function getSitePathForId( siteId: string ): Promise< string | null > {
	try {
		const userData = await loadUserData();
		const site = userData.sites.find( ( s ) => s.id === siteId );
		return site?.path ?? null;
	} catch {
		return null;
	}
}

/**
 * Convert chat history to Anthropic message format.
 */
function formatMessages( history: AgentMessage[], currentMessage: string ): ConversationMessage[] {
	const messages: ConversationMessage[] = [];

	// Add history (excluding tool-related details for simplicity)
	for ( const msg of history ) {
		messages.push( {
			role: msg.role,
			content: msg.content,
		} );
	}

	// Add current user message
	messages.push( {
		role: 'user',
		content: currentMessage,
	} );

	return messages;
}

/**
 * Process a streaming chat request with tool use support.
 */
export async function processChat(
	message: string,
	siteId: string,
	history: AgentMessage[],
	res: Response
): Promise< void > {
	const client = await createClient();

	if ( ! client ) {
		sendSSE( res, {
			type: 'error',
			data: {
				message: 'Anthropic API key not configured. Please set up your API key.',
				code: 'NO_API_KEY',
			},
		} );
		res.end();
		return;
	}

	const tools = getToolDefinitions().map( ( tool ) => ( {
		name: tool.name,
		description: tool.description,
		input_schema: tool.input_schema,
	} ) ) as Anthropic.Tool[];

	const messages = formatMessages( history, message );
	let iterationCount = 0;

	// Build enhanced system prompt with skills
	let systemPrompt = SYSTEM_PROMPT;
	try {
		const sitePath = await getSitePathForId( siteId );
		if ( sitePath ) {
			const skills = await discoverSiteSkills( sitePath );
			const skillsXml = buildSkillsPromptXml( skills );
			if ( skillsXml ) {
				systemPrompt = `${ SYSTEM_PROMPT }\n\n${ skillsXml }`;
			}
		}
	} catch ( skillError ) {
		// Log but don't fail the request if skills can't be loaded
		console.warn( 'Failed to load skills for site:', skillError );
	}

	// Send message start event
	sendSSE( res, { type: 'message_start', data: {} } );

	// Track cumulative block offset across iterations for interleaved rendering
	let blockIndexOffset = 0;

	while ( iterationCount < MAX_TOOL_ITERATIONS ) {
		iterationCount++;

		try {
			// Create streaming response
			const stream = await client.messages.stream( {
				model: MODEL,
				max_tokens: MAX_TOKENS,
				system: systemPrompt,
				tools,
				messages,
			} );

			let fullText = '';
			const toolCalls: ToolCall[] = [];
			const contentBlocks: ContentBlockTracker[] = [];
			let maxBlockIndex = -1;

			// Process the stream - track content blocks by index for interleaved rendering
			for await ( const event of stream ) {
				if ( event.type === 'content_block_start' ) {
					const localIndex = event.index;
					const globalIndex = localIndex + blockIndexOffset;
					maxBlockIndex = Math.max( maxBlockIndex, localIndex );

					if ( event.content_block.type === 'text' ) {
						contentBlocks[ localIndex ] = {
							index: localIndex,
							type: 'text',
							text: '',
						};

						sendSSE( res, {
							type: 'content_block_start',
							data: {
								index: globalIndex,
								blockType: 'text',
							},
						} );
					} else if ( event.content_block.type === 'tool_use' ) {
						contentBlocks[ localIndex ] = {
							index: localIndex,
							type: 'tool_use',
							toolId: event.content_block.id,
							toolName: event.content_block.name,
							toolInput: '',
						};

						sendSSE( res, {
							type: 'content_block_start',
							data: {
								index: globalIndex,
								blockType: 'tool_use',
								id: event.content_block.id,
								name: event.content_block.name,
							},
						} );
					}
				} else if ( event.type === 'content_block_delta' ) {
					const localIndex = event.index;
					const globalIndex = localIndex + blockIndexOffset;
					const block = contentBlocks[ localIndex ];

					if ( event.delta.type === 'text_delta' ) {
						if ( block && block.type === 'text' ) {
							block.text = ( block.text || '' ) + event.delta.text;
						}
						fullText += event.delta.text;

						sendSSE( res, {
							type: 'content_delta',
							data: {
								index: globalIndex,
								text: event.delta.text,
							},
						} );
					} else if ( event.delta.type === 'input_json_delta' ) {
						if ( block && block.type === 'tool_use' ) {
							block.toolInput = ( block.toolInput || '' ) + event.delta.partial_json;
						}
					}
				} else if ( event.type === 'content_block_stop' ) {
					const localIndex = event.index;
					const globalIndex = localIndex + blockIndexOffset;
					const block = contentBlocks[ localIndex ];

					if ( block && block.type === 'tool_use' && block.toolId && block.toolName ) {
						let parsedInput = {};
						try {
							parsedInput = block.toolInput ? JSON.parse( block.toolInput ) : {};
						} catch ( e ) {
							console.error( 'Failed to parse tool input:', e );
						}

						toolCalls.push( {
							id: block.toolId,
							name: block.toolName,
							input: parsedInput,
						} );

						sendSSE( res, {
							type: 'content_block_stop',
							data: {
								index: globalIndex,
								blockType: 'tool_use',
								id: block.toolId,
								name: block.toolName,
								input: parsedInput,
							},
						} );
					} else if ( block && block.type === 'text' ) {
						sendSSE( res, {
							type: 'content_block_stop',
							data: {
								index: globalIndex,
								blockType: 'text',
							},
						} );
					}
				}
			}

			// Update offset for next iteration (add 1 for 0-based indexing)
			blockIndexOffset += maxBlockIndex + 1;

			// Get the final message to check stop reason
			const finalMessage = await stream.finalMessage();

			// If no tool calls, we're done
			if ( toolCalls.length === 0 || finalMessage.stop_reason !== 'tool_use' ) {
				sendSSE( res, {
					type: 'content_done',
					data: { text: fullText },
				} );
				break;
			}

			// Execute tool calls
			const toolResults: ToolResultMessage[] = [];

			for ( const toolCall of toolCalls ) {
				const result = await executeTool( toolCall, siteId );

				toolResults.push( {
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					result,
					executedAt: Date.now(),
				} );

				sendSSE( res, {
					type: 'tool_result',
					data: {
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						result,
					},
				} );
			}

			// Build the assistant message with tool use
			const assistantContent: Anthropic.ContentBlockParam[] = [];

			if ( fullText ) {
				assistantContent.push( {
					type: 'text',
					text: fullText,
				} );
			}

			for ( const toolCall of toolCalls ) {
				assistantContent.push( {
					type: 'tool_use',
					id: toolCall.id,
					name: toolCall.name,
					input: toolCall.input as Record< string, unknown >,
				} );
			}

			// Add assistant message with tool calls
			messages.push( {
				role: 'assistant',
				content: assistantContent,
			} );

			// Add tool results as user message
			const toolResultContent: Anthropic.ToolResultBlockParam[] = toolResults.map( ( tr ) => ( {
				type: 'tool_result' as const,
				tool_use_id: tr.toolCallId,
				content: tr.result.success ? tr.result.output || 'Success' : `Error: ${ tr.result.error }`,
				is_error: ! tr.result.success,
			} ) );

			messages.push( {
				role: 'user',
				content: toolResultContent as unknown as string,
			} );

			// Continue the loop to get Claude's response to tool results
		} catch ( error ) {
			const errorMessage = error instanceof Error ? error.message : String( error );
			sendSSE( res, {
				type: 'error',
				data: {
					message: `API error: ${ errorMessage }`,
					code: 'API_ERROR',
				},
			} );
			break;
		}
	}

	if ( iterationCount >= MAX_TOOL_ITERATIONS ) {
		sendSSE( res, {
			type: 'error',
			data: {
				message: 'Maximum tool iterations reached. Please try a simpler request.',
				code: 'MAX_ITERATIONS',
			},
		} );
	}

	sendSSE( res, {
		type: 'message_done',
		data: { messageId: crypto.randomUUID() },
	} );

	res.end();
}

/**
 * Validate that the API key works by making a simple request.
 */
export async function validateApiKey( apiKey: string ): Promise< boolean > {
	try {
		const client = new Anthropic( { apiKey } );
		await client.messages.create( {
			model: MODEL,
			max_tokens: 10,
			messages: [ { role: 'user', content: 'Hi' } ],
		} );
		return true;
	} catch ( error ) {
		console.error( 'API key validation failed:', error );
		return false;
	}
}
