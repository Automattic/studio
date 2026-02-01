import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AgentCodeBlock } from 'src/components/agent-code-block';
import { AgentSelector } from 'src/components/agent-selector';
import { AgentToolResultsList } from 'src/components/agent-tool-result';
import { AiSettingsModal } from 'src/components/ai-settings-modal';
import { ApiKeySetup, ApiKeySetupBanner } from 'src/components/api-key-setup';
import { AssistantInput } from 'src/components/assistant-input';
import { MessageThinking } from 'src/components/assistant-thinking';
import { ChatMessage } from 'src/components/chat-message';
import { ModelSelector } from 'src/components/model-selector';
import WelcomeComponent from 'src/components/welcome-message-prompt';
import { useAgentChat } from 'src/hooks/use-agent-chat';
import { cx } from 'src/lib/cx';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	agentChatActions,
	agentChatSelectors,
	agentChatThunks,
	AgentMessage,
} from 'src/stores/agent-chat-slice';
import { useGetWelcomeMessages } from 'src/stores/wpcom-api';
import type { ContentBlock } from 'src/modules/ai-agent/types';

interface AgentChatViewProps {
	selectedSite: SiteDetails;
}

function renderContentBlock(
	block: ContentBlock,
	index: number,
	toolCalls?: AgentMessage[ 'toolCalls' ]
) {
	if ( block.type === 'text' && block.text ) {
		// Heading style override - uniform weight
		const headingStyle = { fontWeight: 600, fontSize: 'inherit', margin: '1rem 0 0.5rem 0' };
		return (
			<div key={ `text-${ index }` } className="assistant-markdown">
				<ReactMarkdown
					remarkPlugins={ [ remarkGfm ] }
					components={ {
						code: AgentCodeBlock,
						// Override pre to be unstyled - AgentCodeBlock handles its own pre styling
						pre: ( { children } ) => <>{ children }</>,
						// Normalize heading styles
						h1: ( { children } ) => <h1 style={ headingStyle }>{ children }</h1>,
						h2: ( { children } ) => <h2 style={ headingStyle }>{ children }</h2>,
						h3: ( { children } ) => <h3 style={ headingStyle }>{ children }</h3>,
						h4: ( { children } ) => <h4 style={ headingStyle }>{ children }</h4>,
						h5: ( { children } ) => <h5 style={ headingStyle }>{ children }</h5>,
						h6: ( { children } ) => <h6 style={ headingStyle }>{ children }</h6>,
					} }
				>
					{ block.text }
				</ReactMarkdown>
			</div>
		);
	}

	if ( block.type === 'tool_call' && block.toolCall ) {
		// Find the matching tool call with result from toolCalls array
		const toolCallWithResult = toolCalls?.find( ( tc ) => tc.id === block.toolCall.id );
		const toolCallToRender = toolCallWithResult || block.toolCall;

		return <AgentToolResultsList key={ `tool-${ index }` } toolCalls={ [ toolCallToRender ] } />;
	}

	return null;
}

function AgentMessageContent( { message }: { message: AgentMessage } ) {
	// Use contentBlocks for interleaved rendering if available
	const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0;

	return (
		<div>
			{ hasContentBlocks ? (
				// Render content blocks in order (interleaved text and tool calls)
				message.contentBlocks!.map( ( block, index ) =>
					renderContentBlock( block, index, message.toolCalls )
				)
			) : (
				// Fallback to old rendering for backwards compatibility
				<>
					{ message.content && (
						<div className="assistant-markdown">
							<ReactMarkdown
								remarkPlugins={ [ remarkGfm ] }
								components={ {
									code: AgentCodeBlock,
									// Override pre to be unstyled - AgentCodeBlock handles its own pre styling
									pre: ( { children } ) => <>{ children }</>,
									// Normalize heading styles
									h1: ( { children } ) => (
										<h1 style={ { fontWeight: 600, fontSize: 'inherit', margin: '1rem 0 0.5rem 0' } }>
											{ children }
										</h1>
									),
									h2: ( { children } ) => (
										<h2 style={ { fontWeight: 600, fontSize: 'inherit', margin: '1rem 0 0.5rem 0' } }>
											{ children }
										</h2>
									),
									h3: ( { children } ) => (
										<h3 style={ { fontWeight: 600, fontSize: 'inherit', margin: '1rem 0 0.5rem 0' } }>
											{ children }
										</h3>
									),
									h4: ( { children } ) => (
										<h4 style={ { fontWeight: 600, fontSize: 'inherit', margin: '1rem 0 0.5rem 0' } }>
											{ children }
										</h4>
									),
									h5: ( { children } ) => (
										<h5 style={ { fontWeight: 600, fontSize: 'inherit', margin: '1rem 0 0.5rem 0' } }>
											{ children }
										</h5>
									),
									h6: ( { children } ) => (
										<h6 style={ { fontWeight: 600, fontSize: 'inherit', margin: '1rem 0 0.5rem 0' } }>
											{ children }
										</h6>
									),
								} }
							>
								{ message.content }
							</ReactMarkdown>
						</div>
					) }
					{ message.toolCalls && message.toolCalls.length > 0 && (
						<AgentToolResultsList toolCalls={ message.toolCalls } />
					) }
				</>
			) }
			{ message.error && (
				<div className="mt-2 p-2 bg-a8c-red-5 border border-a8c-red-10 rounded text-sm text-a8c-red-70">
					{ message.error }
				</div>
			) }
		</div>
	);
}

export function AgentChatView( { selectedSite }: AgentChatViewProps ) {
	const dispatch = useAppDispatch();
	const inputRef = useRef< HTMLTextAreaElement >( null );
	const messagesEndRef = useRef< HTMLDivElement >( null );
	const scrollContainerRef = useRef< HTMLDivElement >( null );
	const wrapperRef = useRef< HTMLDivElement >( null );
	const shouldAutoScrollRef = useRef( true );

	const {
		messages,
		isLoading,
		isStreaming,
		sendMessage,
		clearConversation,
		instanceId,
		availableModels,
		currentModelId,
		setModel,
	} = useAgentChat( { siteId: selectedSite.id } );

	const isConfigured = useRootSelector( agentChatSelectors.selectIsConfigured );
	const serverPort = useRootSelector( agentChatSelectors.selectAgentServerPort );
	const chatInput = useRootSelector( ( state ) =>
		agentChatSelectors.selectChatInput( state, selectedSite.id )
	);

	const [ showApiKeySetup, setShowApiKeySetup ] = useState( false );
	const [ showAiSettingsModal, setShowAiSettingsModal ] = useState( false );

	// Get welcome messages and example prompts from API (same as WordPress.com chat)
	const { data: welcomeData, isLoading: isLoadingWelcome } = useGetWelcomeMessages();

	// Check agent status on mount
	useEffect( () => {
		if ( serverPort ) {
			void dispatch( agentChatThunks.checkAgentStatus() );
		}
	}, [ dispatch, serverPort ] );

	// Extract last message content for dependency array
	const lastMessageContent = messages[ messages.length - 1 ]?.content;

	// Check if user is near the bottom of the scroll container
	const isNearBottom = useCallback( () => {
		const container = scrollContainerRef.current;
		if ( ! container ) {
			return true;
		}
		const threshold = 100; // pixels from bottom
		return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
	}, [] );

	// Handle scroll events to detect when user scrolls away from bottom
	useEffect( () => {
		const container = scrollContainerRef.current;
		if ( ! container ) {
			return;
		}

		const handleScroll = () => {
			shouldAutoScrollRef.current = isNearBottom();
		};

		container.addEventListener( 'scroll', handleScroll );
		return () => container.removeEventListener( 'scroll', handleScroll );
	}, [ isNearBottom ] );

	// Scroll to bottom when messages change (only if user hasn't scrolled up)
	useEffect( () => {
		if ( messagesEndRef.current && shouldAutoScrollRef.current ) {
			messagesEndRef.current.scrollIntoView( { behavior: 'smooth' } );
		}
	}, [ messages.length, lastMessageContent ] );

	const handleSendMessage = useCallback( () => {
		const message = chatInput.trim();
		if ( ! message ) {
			return;
		}

		dispatch( agentChatActions.setChatInput( { siteId: selectedSite.id, input: '' } ) );
		void sendMessage( message );
	}, [ chatInput, dispatch, selectedSite.id, sendMessage ] );

	const handleExampleClick = useCallback(
		( prompt: string ) => {
			void sendMessage( prompt );
			inputRef.current?.focus();
		},
		[ sendMessage ]
	);

	const handleClearConversation = useCallback( () => {
		dispatch( agentChatActions.setChatInput( { siteId: selectedSite.id, input: '' } ) );
		clearConversation();
		inputRef.current?.focus();
	}, [ dispatch, selectedSite.id, clearConversation ] );

	// Show API key setup if not configured
	if ( ! isConfigured ) {
		return (
			<div className="h-full flex flex-col">
				<ApiKeySetupBanner onConfigure={ () => setShowApiKeySetup( true ) } />
				<ApiKeySetup
					isOpen={ showApiKeySetup }
					onClose={ () => setShowApiKeySetup( false ) }
					onSuccess={ () => dispatch( agentChatActions.setIsConfigured( true ) ) }
				/>
			</div>
		);
	}

	const hasMessages = messages.length > 0;
	const isAssistantThinking = isLoading || isStreaming;

	return (
		<div className="h-full flex flex-col bg-gray-50 overflow-hidden" ref={ wrapperRef }>
			{ /* Messages area - scrollable */ }
			<div
				ref={ scrollContainerRef }
				className={ cx(
					'flex-1 overflow-y-auto p-8 pb-8',
					! hasMessages && 'flex items-center justify-center'
				) }
			>
				<div className={ cx( 'max-w-3xl', hasMessages ? 'mx-auto' : 'w-full' ) }>
					{ /* Welcome message and suggestions (same as WordPress.com chat) */ }
					<WelcomeComponent
						onExampleClick={ handleExampleClick }
						showExamplePrompts={ ! hasMessages }
						messages={ welcomeData?.messages ?? [] }
						examplePrompts={ welcomeData?.example_prompts ?? [] }
						siteId={ selectedSite.id }
						disabled={ isAssistantThinking }
						isLoading={ isLoadingWelcome }
					/>

					{ /* Chat messages */ }
					{ messages.map( ( message ) => (
						<ChatMessage
							key={ message.id }
							id={ `message-agent-${ message.id }` }
							message={ { role: message.role, content: message.content } as never }
							siteId={ selectedSite.id }
							instanceId={ instanceId }
						>
							{ message.role === 'user' ? (
								message.content
							) : (
								<AgentMessageContent message={ message } />
							) }
							{ message.isStreaming && ! message.content && <MessageThinking /> }
						</ChatMessage>
					) ) }
					<div ref={ messagesEndRef } />
				</div>
			</div>

			{ /* Gradient fade - messages scroll behind this */ }
			<div className="h-10 w-full bg-gradient-to-t from-gray-50 from-50% to-transparent -mt-10 relative z-10 pointer-events-none" />

			{ /* Input area */ }
			<div className="w-full bg-gray-50 px-8 pb-6 flex items-center">
				<div className="w-full flex flex-col items-center">
					<AssistantInput
						ref={ inputRef }
						disabled={ false }
						input={ chatInput }
						setInput={ ( input ) => {
							dispatch( agentChatActions.setChatInput( { siteId: selectedSite.id, input } ) );
						} }
						handleSend={ handleSendMessage }
						handleKeyDown={ ( event ) => {
							if ( event.key === 'Enter' && ! event.shiftKey ) {
								event.preventDefault();
								handleSendMessage();
							}
						} }
						onClearConversation={ handleClearConversation }
						onOpenAgentSettings={ () => setShowAiSettingsModal( true ) }
						onOpenSkillSettings={ () => setShowAiSettingsModal( true ) }
						onOpenInstructionSettings={ () => setShowAiSettingsModal( true ) }
						isLoading={ isAssistantThinking }
						agentSelector={ <AgentSelector /> }
						modelSelector={
							availableModels && currentModelId ? (
								<ModelSelector
									availableModels={ availableModels }
									currentModelId={ currentModelId }
									onModelChange={ setModel }
									disabled={ isAssistantThinking }
								/>
							) : undefined
						}
					/>
				</div>
			</div>

			<ApiKeySetup
				isOpen={ showApiKeySetup }
				onClose={ () => setShowApiKeySetup( false ) }
				onSuccess={ () => dispatch( agentChatActions.setIsConfigured( true ) ) }
			/>

			<AiSettingsModal
				isOpen={ showAiSettingsModal }
				onClose={ () => setShowAiSettingsModal( false ) }
				siteId={ selectedSite.id }
			/>
		</div>
	);
}
