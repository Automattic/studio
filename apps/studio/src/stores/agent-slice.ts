import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { getToolDisplayName, getToolDetail } from '@studio/common/types/agent-messages';
import type {
	SerializedAgentMessage,
	AgentToolUseBlock,
} from '@studio/common/types/agent-messages';

export type AgentUIMessage =
	| { type: 'user-prompt'; text: string; timestamp: number }
	| { type: 'assistant-text'; text: string; timestamp: number }
	| {
			type: 'tool-call';
			id: string;
			name: string;
			displayName: string;
			detail: string;
			input: Record< string, unknown >;
			startTime: number;
			endTime?: number;
			isError?: boolean;
			resultPreview?: string;
	  }
	| { type: 'tool-screenshot'; imageData: string; mimeType: string; timestamp: number }
	| { type: 'error'; message: string; timestamp: number }
	| {
			type: 'turn-complete';
			numTurns: number;
			costUsd: number;
			durationSec: number;
			timestamp: number;
	  };

export type AgentStatus = 'idle' | 'thinking' | 'tool-running' | 'asking-user' | 'error';

interface AgentState {
	status: AgentStatus;
	sessionId: string | null;
	messages: AgentUIMessage[];
	pendingQuestions: Array< {
		question: string;
		options: Array< { label: string; description: string } >;
	} > | null;
	inputText: string;
	currentModel: string;
	turnStartTime: number | null;
	lastToolId: string | null;
}

const initialState: AgentState = {
	status: 'idle',
	sessionId: null,
	messages: [],
	pendingQuestions: null,
	inputText: '',
	currentModel: 'claude-sonnet-4-6',
	turnStartTime: null,
	lastToolId: null,
};

const agentSlice = createSlice( {
	name: 'agent',
	initialState,
	reducers: {
		addUserPrompt( state, action: PayloadAction< string > ) {
			state.messages.push( {
				type: 'user-prompt',
				text: action.payload,
				timestamp: Date.now(),
			} );
			state.status = 'thinking';
			state.turnStartTime = Date.now();
		},

		agentMessageReceived( state, action: PayloadAction< SerializedAgentMessage > ) {
			const msg = action.payload;

			switch ( msg.type ) {
				case 'assistant': {
					for ( const block of msg.message.content ) {
						if ( block.type === 'text' && block.text ) {
							// Append text to the last assistant-text message if consecutive,
							// otherwise create a new one
							const lastMsg = state.messages[ state.messages.length - 1 ];
							if ( lastMsg && lastMsg.type === 'assistant-text' ) {
								lastMsg.text += ( lastMsg.text.endsWith( '\n' ) ? '' : '\n' ) + block.text;
							} else {
								state.messages.push( {
									type: 'assistant-text',
									text: block.text,
									timestamp: Date.now(),
								} );
							}
							state.status = 'thinking';
						} else if ( block.type === 'tool_use' ) {
							const toolBlock = block as AgentToolUseBlock;
							state.status = 'tool-running';
							state.lastToolId = toolBlock.id;
							state.messages.push( {
								type: 'tool-call',
								id: toolBlock.id,
								name: toolBlock.name,
								displayName: getToolDisplayName( toolBlock.name ),
								detail: getToolDetail( toolBlock.name, toolBlock.input ),
								input: toolBlock.input,
								startTime: Date.now(),
							} );
						}
					}
					break;
				}

				case 'user': {
					// This is a tool result message
					const result = msg.tool_use_result;
					if ( ! result || typeof result !== 'object' ) {
						break;
					}

					// Find the matching tool-call and update it
					const toolCallIndex = findLastToolCallIndex( state.messages, state.lastToolId );
					if ( toolCallIndex >= 0 ) {
						const toolCall = state.messages[ toolCallIndex ];
						if ( toolCall.type === 'tool-call' ) {
							toolCall.endTime = Date.now();
							toolCall.isError = result.isError === true;

							// Extract text preview from result content
							const textContent = result.content
								?.filter( ( c ) => c.type === 'text' && c.text )
								.map( ( c ) => c.text )
								.join( '\n' );
							if ( textContent ) {
								toolCall.resultPreview =
									textContent.length > 500 ? textContent.slice( 0, 497 ) + '…' : textContent;
							}

							// Extract images (screenshots)
							const imageContent = result.content?.filter(
								( c ) => c.type === 'image' && c.data && c.mimeType
							);
							if ( imageContent ) {
								for ( const img of imageContent ) {
									if ( img.data && img.mimeType ) {
										state.messages.push( {
											type: 'tool-screenshot',
											imageData: img.data,
											mimeType: img.mimeType,
											timestamp: Date.now(),
										} );
									}
								}
							}
						}
					}
					state.status = 'thinking';
					break;
				}

				case 'result': {
					if ( msg.subtype === 'success' ) {
						const duration = state.turnStartTime
							? Math.round( ( Date.now() - state.turnStartTime ) / 1000 )
							: 0;
						state.messages.push( {
							type: 'turn-complete',
							numTurns: msg.num_turns,
							costUsd: msg.total_cost_usd,
							durationSec: duration,
							timestamp: Date.now(),
						} );
					} else if ( msg.subtype === 'error_max_turns' ) {
						state.messages.push( {
							type: 'error',
							message: `Reached turn limit (${ msg.num_turns } turns). You can continue the conversation.`,
							timestamp: Date.now(),
						} );
					} else {
						const errorParts: string[] = [];
						if ( msg.errors?.length ) {
							errorParts.push( ...msg.errors );
						}
						if ( msg.permission_denials?.length ) {
							for ( const denial of msg.permission_denials ) {
								errorParts.push( `Permission denied: ${ denial.tool_name }` );
							}
						}
						state.messages.push( {
							type: 'error',
							message: errorParts.length > 0 ? errorParts.join( '\n' ) : 'Unknown error',
							timestamp: Date.now(),
						} );
					}
					state.sessionId = msg.session_id;
					state.status = 'idle';
					state.turnStartTime = null;
					state.lastToolId = null;
					break;
				}
			}
		},

		askUserReceived(
			state,
			action: PayloadAction<
				Array< {
					question: string;
					options: Array< { label: string; description: string } >;
				} >
			>
		) {
			state.pendingQuestions = action.payload;
			state.status = 'asking-user';
		},

		askUserAnswered( state ) {
			state.pendingQuestions = null;
			state.status = 'thinking';
		},

		agentErrorReceived( state, action: PayloadAction< string > ) {
			state.messages.push( {
				type: 'error',
				message: action.payload,
				timestamp: Date.now(),
			} );
			state.status = 'error';
		},

		setInputText( state, action: PayloadAction< string > ) {
			state.inputText = action.payload;
		},

		setModel( state, action: PayloadAction< string > ) {
			state.currentModel = action.payload;
		},

		clearConversation( state ) {
			state.messages = [];
			state.sessionId = null;
			state.status = 'idle';
			state.pendingQuestions = null;
			state.turnStartTime = null;
			state.lastToolId = null;
		},
	},
} );

function findLastToolCallIndex( messages: AgentUIMessage[], toolId: string | null ): number {
	if ( ! toolId ) {
		// Fall back to finding the last unresolved tool-call
		for ( let i = messages.length - 1; i >= 0; i-- ) {
			const msg = messages[ i ];
			if ( msg.type === 'tool-call' && ! msg.endTime ) {
				return i;
			}
		}
		return -1;
	}
	for ( let i = messages.length - 1; i >= 0; i-- ) {
		const msg = messages[ i ];
		if ( msg.type === 'tool-call' && msg.id === toolId ) {
			return i;
		}
	}
	return -1;
}

export const agentActions = agentSlice.actions;
export const agentReducer = agentSlice.reducer;
