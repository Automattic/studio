import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import * as Sentry from '@sentry/electron/renderer';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { DEFAULT_AGENT_ID } from 'src/modules/acp/config/agents';
import type { AgentConfig, AcpSession, AgentStatus } from 'src/modules/acp/types';
import type { ToolCallDisplay, AgentMessageDisplay } from 'src/modules/ai-agent/types';
import type { AppDispatch, RootState } from 'src/stores';

// Re-export types for backwards compatibility
export type { ToolCallDisplay };
export type AgentMessage = AgentMessageDisplay;

const LOCAL_STORAGE_AGENT_MESSAGES_KEY = 'studio_agent_messages';
const LOCAL_STORAGE_SELECTED_AGENT_KEY = 'studio_selected_agent';

export interface AgentChatState {
	messagesDict: Record< string, AgentMessage[] >;
	isLoadingDict: Record< string, boolean >;
	isStreamingDict: Record< string, boolean >;
	/** Selected agent ID (default: 'wpcom') */
	selectedAgentId: string;
	/** Available agents (built-in + detected) */
	availableAgents: AgentConfig[];
	/** Agent status by ID */
	agentStatusDict: Record< string, AgentStatus >;
	/** Active ACP sessions by session ID */
	acpSessions: Record< string, AcpSession >;
	/** Agent server port (for built-in Anthropic agent) */
	agentServerPort: number | null;
	/** Whether built-in agent is configured */
	isConfigured: boolean;
	/** Chat input by site ID */
	chatInputBySite: Record< string, string >;
	/** Whether agents are being loaded */
	isLoadingAgents: boolean;
}

const getInitialState = (): AgentChatState => {
	let parsedStoredMessages: AgentChatState[ 'messagesDict' ] = {};
	let selectedAgentId = DEFAULT_AGENT_ID;

	try {
		const storedMessages = localStorage.getItem( LOCAL_STORAGE_AGENT_MESSAGES_KEY );
		parsedStoredMessages = storedMessages ? JSON.parse( storedMessages ) : {};

		const storedAgent = localStorage.getItem( LOCAL_STORAGE_SELECTED_AGENT_KEY );
		if ( storedAgent ) {
			selectedAgentId = storedAgent;
		}
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( 'Failed to parse stored agent chat data:', error );
	}

	return {
		messagesDict: parsedStoredMessages,
		isLoadingDict: {},
		isStreamingDict: {},
		selectedAgentId,
		availableAgents: [],
		agentStatusDict: {},
		acpSessions: {},
		agentServerPort: null,
		isConfigured: false,
		chatInputBySite: {},
		isLoadingAgents: false,
	};
};

const createTypedAsyncThunk = createAsyncThunk.withTypes< {
	state: RootState;
	dispatch: AppDispatch;
} >();

/**
 * Load available agents from the main process.
 */
export const loadAvailableAgents = createTypedAsyncThunk(
	'agentChat/loadAvailableAgents',
	async () => {
		const agents = await getIpcApi().getAvailableAgents();
		return { agents };
	}
);

/**
 * Set the selected agent.
 */
export const selectAgent = createTypedAsyncThunk(
	'agentChat/selectAgent',
	async ( agentId: string ) => {
		await getIpcApi().setSelectedAgentId( agentId );
		localStorage.setItem( LOCAL_STORAGE_SELECTED_AGENT_KEY, agentId );
		return { agentId };
	}
);

/**
 * Check agent server status.
 */
export const checkAgentStatus = createTypedAsyncThunk(
	'agentChat/checkStatus',
	async ( _, thunkAPI ) => {
		const state = thunkAPI.getState();
		const serverPort = state.agentChat.agentServerPort;

		if ( ! serverPort ) {
			return { isConfigured: false };
		}

		try {
			const response = await fetch( `http://127.0.0.1:${ serverPort }/status` );
			if ( response.ok ) {
				const status = await response.json();
				return { isConfigured: status.isConfigured };
			}
		} catch ( error ) {
			console.error( 'Failed to check agent status:', error );
		}

		return { isConfigured: false };
	}
);

/**
 * Configure the Anthropic API key.
 */
export const configureApiKey = createTypedAsyncThunk(
	'agentChat/configureApiKey',
	async ( apiKey: string, thunkAPI ) => {
		const state = thunkAPI.getState();
		const serverPort = state.agentChat.agentServerPort;

		if ( ! serverPort ) {
			throw new Error( 'Agent server not running' );
		}

		const response = await fetch( `http://127.0.0.1:${ serverPort }/configure`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { apiKey } ),
		} );

		const result = await response.json();

		if ( ! response.ok ) {
			throw new Error( result.error || 'Failed to configure API key' );
		}

		return { success: true };
	}
);

const EMPTY_MESSAGES: readonly AgentMessage[] = Object.freeze( [] );

const agentChatSlice = createSlice( {
	name: 'agentChat',
	initialState: getInitialState(),
	reducers: {
		setAgentServerPort: ( state, action: PayloadAction< number | null > ) => {
			state.agentServerPort = action.payload;
		},

		setSelectedAgentId: ( state, action: PayloadAction< string > ) => {
			state.selectedAgentId = action.payload;
			localStorage.setItem( LOCAL_STORAGE_SELECTED_AGENT_KEY, action.payload );
		},

		setAvailableAgents: ( state, action: PayloadAction< AgentConfig[] > ) => {
			state.availableAgents = action.payload;
		},

		setAgentStatus: (
			state,
			action: PayloadAction< { agentId: string; status: AgentStatus } >
		) => {
			const { agentId, status } = action.payload;
			state.agentStatusDict[ agentId ] = status;
		},

		setAcpSession: ( state, action: PayloadAction< AcpSession > ) => {
			state.acpSessions[ action.payload.id ] = action.payload;
		},

		updateAcpSessionState: (
			state,
			action: PayloadAction< {
				sessionId: string;
				sessionState: AcpSession[ 'state' ];
				error?: string;
			} >
		) => {
			const { sessionId, sessionState, error } = action.payload;
			if ( state.acpSessions[ sessionId ] ) {
				state.acpSessions[ sessionId ].state = sessionState;
				if ( error ) {
					state.acpSessions[ sessionId ].error = error;
				}
			}
		},

		removeAcpSession: ( state, action: PayloadAction< string > ) => {
			delete state.acpSessions[ action.payload ];
		},

		setIsConfigured: ( state, action: PayloadAction< boolean > ) => {
			state.isConfigured = action.payload;
		},

		setChatInput: ( state, action: PayloadAction< { siteId: string; input: string } > ) => {
			const { siteId, input } = action.payload;
			state.chatInputBySite[ siteId ] = input;
		},

		addUserMessage: ( state, action: PayloadAction< { instanceId: string; message: string } > ) => {
			const { instanceId, message } = action.payload;

			if ( ! state.messagesDict[ instanceId ] ) {
				state.messagesDict[ instanceId ] = [];
			}

			const userMessage: AgentMessage = {
				id: crypto.randomUUID(),
				role: 'user',
				content: message,
				createdAt: Date.now(),
			};

			state.messagesDict[ instanceId ].push( userMessage );
		},

		startAssistantMessage: ( state, action: PayloadAction< { instanceId: string } > ) => {
			const { instanceId } = action.payload;

			if ( ! state.messagesDict[ instanceId ] ) {
				state.messagesDict[ instanceId ] = [];
			}

			const assistantMessage: AgentMessage = {
				id: crypto.randomUUID(),
				role: 'assistant',
				content: '',
				contentBlocks: [],
				createdAt: Date.now(),
				isStreaming: true,
			};

			state.messagesDict[ instanceId ].push( assistantMessage );
			state.isStreamingDict[ instanceId ] = true;
		},

		appendToAssistantMessage: (
			state,
			action: PayloadAction< { instanceId: string; text: string; index?: number } >
		) => {
			const { instanceId, text, index } = action.payload;
			const messages = state.messagesDict[ instanceId ];

			if ( messages && messages.length > 0 ) {
				const lastMessage = messages[ messages.length - 1 ];
				if ( lastMessage.role === 'assistant' && lastMessage.isStreaming ) {
					// Also update content for backwards compatibility
					lastMessage.content += text;

					// Update content block if index provided
					if ( index !== undefined && lastMessage.contentBlocks ) {
						const block = lastMessage.contentBlocks[ index ];
						if ( block && block.type === 'text' ) {
							block.text += text;
						}
					}
				}
			}
		},

		startContentBlock: (
			state,
			action: PayloadAction< {
				instanceId: string;
				index: number;
				blockType: 'text' | 'tool_use';
				id?: string;
				name?: string;
			} >
		) => {
			const { instanceId, index, blockType, id, name } = action.payload;
			const messages = state.messagesDict[ instanceId ];

			if ( messages && messages.length > 0 ) {
				const lastMessage = messages[ messages.length - 1 ];
				if ( lastMessage.role === 'assistant' && lastMessage.contentBlocks ) {
					if ( blockType === 'text' ) {
						lastMessage.contentBlocks[ index ] = {
							type: 'text',
							text: '',
						};
					} else if ( blockType === 'tool_use' && id && name ) {
						lastMessage.contentBlocks[ index ] = {
							type: 'tool_call',
							toolCall: {
								id,
								name,
								input: {},
							},
						};
					}
				}
			}
		},

		finishContentBlock: (
			state,
			action: PayloadAction< {
				instanceId: string;
				index: number;
				blockType: 'text' | 'tool_use';
				id?: string;
				name?: string;
				input?: Record< string, unknown >;
			} >
		) => {
			const { instanceId, index, blockType, id, name, input } = action.payload;
			const messages = state.messagesDict[ instanceId ];

			if ( messages && messages.length > 0 ) {
				const lastMessage = messages[ messages.length - 1 ];
				if ( lastMessage.role === 'assistant' && lastMessage.contentBlocks ) {
					// For tool_use blocks, update with final input
					if ( blockType === 'tool_use' && id && name ) {
						const block = lastMessage.contentBlocks[ index ];
						if ( block && block.type === 'tool_call' ) {
							block.toolCall.input = input || {};
						}

						// Also add to toolCalls array for backwards compatibility
						if ( ! lastMessage.toolCalls ) {
							lastMessage.toolCalls = [];
						}
						lastMessage.toolCalls.push( {
							id,
							name,
							input: input || {},
						} );
					}
				}
			}
		},

		addToolCall: (
			state,
			action: PayloadAction< {
				instanceId: string;
				toolCall: { id: string; name: string; input: Record< string, unknown > };
			} >
		) => {
			const { instanceId, toolCall } = action.payload;
			const messages = state.messagesDict[ instanceId ];

			if ( messages && messages.length > 0 ) {
				const lastMessage = messages[ messages.length - 1 ];
				if ( lastMessage.role === 'assistant' ) {
					if ( ! lastMessage.toolCalls ) {
						lastMessage.toolCalls = [];
					}
					lastMessage.toolCalls.push( {
						id: toolCall.id,
						name: toolCall.name,
						input: toolCall.input,
					} );
				}
			}
		},

		addToolResult: (
			state,
			action: PayloadAction< {
				instanceId: string;
				toolCallId: string;
				result: { success: boolean; output?: string; error?: string };
			} >
		) => {
			const { instanceId, toolCallId, result } = action.payload;
			const messages = state.messagesDict[ instanceId ];

			if ( messages ) {
				for ( const message of messages ) {
					if ( message.toolCalls ) {
						const toolCall = message.toolCalls.find( ( tc ) => tc.id === toolCallId );
						if ( toolCall ) {
							toolCall.result = result;
							toolCall.executedAt = Date.now();
							break;
						}
					}
				}
			}
		},

		finishAssistantMessage: ( state, action: PayloadAction< { instanceId: string } > ) => {
			const { instanceId } = action.payload;
			const messages = state.messagesDict[ instanceId ];

			if ( messages && messages.length > 0 ) {
				const lastMessage = messages[ messages.length - 1 ];
				if ( lastMessage.role === 'assistant' ) {
					lastMessage.isStreaming = false;
				}
			}

			state.isStreamingDict[ instanceId ] = false;
			state.isLoadingDict[ instanceId ] = false;
		},

		setMessageError: ( state, action: PayloadAction< { instanceId: string; error: string } > ) => {
			const { instanceId, error } = action.payload;
			const messages = state.messagesDict[ instanceId ];

			if ( messages && messages.length > 0 ) {
				const lastMessage = messages[ messages.length - 1 ];
				if ( lastMessage.role === 'assistant' ) {
					lastMessage.error = error;
					lastMessage.isStreaming = false;
				}
			}

			state.isStreamingDict[ instanceId ] = false;
			state.isLoadingDict[ instanceId ] = false;
		},

		clearMessages: ( state, action: PayloadAction< { instanceId: string } > ) => {
			const { instanceId } = action.payload;
			state.messagesDict[ instanceId ] = [];
			state.isStreamingDict[ instanceId ] = false;
			state.isLoadingDict[ instanceId ] = false;
		},

		persistMessages: ( state ) => {
			localStorage.setItem(
				LOCAL_STORAGE_AGENT_MESSAGES_KEY,
				JSON.stringify( state.messagesDict )
			);
		},
	},
	extraReducers: ( builder ) => {
		builder
			// Load available agents
			.addCase( loadAvailableAgents.pending, ( state ) => {
				state.isLoadingAgents = true;
			} )
			.addCase( loadAvailableAgents.fulfilled, ( state, action ) => {
				state.availableAgents = action.payload.agents;
				state.isLoadingAgents = false;
				// Update status dict
				for ( const agent of action.payload.agents ) {
					if ( agent.status ) {
						state.agentStatusDict[ agent.id ] = agent.status;
					}
				}
			} )
			.addCase( loadAvailableAgents.rejected, ( state ) => {
				state.isLoadingAgents = false;
			} )
			// Select agent
			.addCase( selectAgent.fulfilled, ( state, action ) => {
				state.selectedAgentId = action.payload.agentId;
			} )
			// Check agent status
			.addCase( checkAgentStatus.fulfilled, ( state, action ) => {
				state.isConfigured = action.payload.isConfigured;
			} )
			// Configure API key
			.addCase( configureApiKey.fulfilled, ( state ) => {
				state.isConfigured = true;
			} );
	},
	selectors: {
		selectMessages: ( state, instanceId: string ) =>
			state.messagesDict[ instanceId ] ?? EMPTY_MESSAGES,
		selectIsLoading: ( state, instanceId: string ) => state.isLoadingDict[ instanceId ] ?? false,
		selectIsStreaming: ( state, instanceId: string ) =>
			state.isStreamingDict[ instanceId ] ?? false,
		selectSelectedAgentId: ( state ) => state.selectedAgentId,
		selectAvailableAgents: ( state ) => state.availableAgents,
		selectAgentStatus: ( state, agentId: string ) =>
			state.agentStatusDict[ agentId ] ?? 'unavailable',
		selectAcpSession: ( state, sessionId: string ) => state.acpSessions[ sessionId ],
		selectAcpSessionsForSite: ( state, siteId: string ) =>
			Object.values( state.acpSessions ).filter( ( s ) => s.siteId === siteId ),
		selectIsLoadingAgents: ( state ) => state.isLoadingAgents,
		/** @deprecated Use selectSelectedAgentId instead. Returns true if not using wpcom agent. */
		selectAgentModeEnabled: ( state ) => state.selectedAgentId !== 'wpcom',
		selectIsConfigured: ( state ) => state.isConfigured,
		selectAgentServerPort: ( state ) => state.agentServerPort,
		selectChatInput: ( state, siteId: string ) => state.chatInputBySite[ siteId ] ?? '',
		selectSelectedAgent: ( state ) =>
			state.availableAgents.find( ( a ) => a.id === state.selectedAgentId ),
	},
} );

export const agentChatActions = agentChatSlice.actions;
export const agentChatSelectors = agentChatSlice.selectors;
export const agentChatThunks = {
	loadAvailableAgents,
	selectAgent,
	checkAgentStatus,
	configureApiKey,
};
export const { reducer: agentChatReducer } = agentChatSlice;
