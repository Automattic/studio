import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, memo } from 'react';
import { AI_GUIDELINES_URL } from '../constants';
import { useAssistant, Message as MessageType } from '../hooks/use-assistant';
import { useAssistantApi } from '../hooks/use-assistant-api';
import { useAuth } from '../hooks/use-auth';
import { useChatContext } from '../hooks/use-chat-context';
import { useFetchWelcomeMessages } from '../hooks/use-fetch-welcome-messages';
import { useOffline } from '../hooks/use-offline';
import { usePromptUsage } from '../hooks/use-prompt-usage';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { AIInput } from './ai-input';
import { MessageThinking } from './assistant-thinking';
import Button from './button';
import { ChatMessage } from './chat-message';
import WelcomeComponent from './welcome-message-prompt';

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

const AuthenticatedView = memo(
	( {
		messages,
		isAssistantThinking,
		updateMessage,
		path,
	}: {
		messages: MessageType[];
		isAssistantThinking: boolean;
		updateMessage: (
			id: number,
			codeBlockContent: string,
			cliOutput: string,
			cliStatus: 'success' | 'error',
			cliTime: string
		) => void;
		path: string;
	} ) => {
		const endOfMessagesRef = useRef< HTMLDivElement >( null );

		useEffect( () => {
			const timer = setTimeout( () => {
				if ( endOfMessagesRef.current ) {
					endOfMessagesRef.current.scrollIntoView( { behavior: 'smooth' } );
				}
			}, 100 ); // Slight delay to ensure DOM updates

			return () => clearTimeout( timer );
		}, [ messages?.length ] );

		return (
			<>
				{ messages.map( ( message, index ) => (
					<ChatMessage
						key={ index }
						id={ `message-chat-${ index }` }
						isUser={ message.role === 'user' }
						projectPath={ path }
						updateMessage={ updateMessage }
						messageId={ message.id }
						blocks={ message.blocks }
					>
						{ message.content }
					</ChatMessage>
				) ) }
				{ isAssistantThinking && (
					<ChatMessage isUser={ false } id="message-thinking">
						<MessageThinking />
					</ChatMessage>
				) }
				<div ref={ endOfMessagesRef } />
			</>
		);
	}
);

const UnauthenticatedView = ( { onAuthenticate }: { onAuthenticate: () => void } ) => (
	<ChatMessage id="message-unauthenticated" className="w-full" isUser={ false }>
		<div className="mb-3 a8c-label-semibold">{ __( 'Hold up!' ) }</div>
		<div className="mb-1">
			{ __( 'You need to log in to your WordPress.com account to use the assistant.' ) }
		</div>
		<div className="mb-1">
			{ createInterpolateElement(
				__( "If you don't have an account yet, <a>create one for free</a>." ),
				{
					a: (
						<Button
							variant="link"
							onClick={ () =>
								getIpcApi().openURL(
									'https://wordpress.com/?utm_source=studio&utm_medium=referral&utm_campaign=assistant_onboarding'
								)
							}
						/>
					),
				}
			) }
		</div>
		<div className="mb-3">
			{ __( 'Every account gets 200 prompts included for free each month.' ) }
		</div>
		<Button variant="primary" onClick={ onAuthenticate }>
			{ __( 'Log in to WordPress.com' ) }
			<Icon className="ltr:ml-1 rtl:mr-1 rtl:scale-x-[-1]" icon={ external } size={ 21 } />
		</Button>
	</ChatMessage>
);

export function ContentTabAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const currentSiteChatContext = useChatContext();
	const { messages, addMessage, clearMessages, updateMessage, chatId } = useAssistant(
		selectedSite.name
	);
	const { userCanSendMessage } = usePromptUsage();
	const { fetchAssistant, isLoading: isAssistantThinking } = useAssistantApi( selectedSite.name );
	const {
		messages: welcomeMessages,
		examplePrompts,
		fetchWelcomeMessages,
	} = useFetchWelcomeMessages();
	const [ input, setInput ] = useState< string >( '' );
	const { isAuthenticated, authenticate } = useAuth();
	const isOffline = useOffline();
	const { __ } = useI18n();

	useEffect( () => {
		fetchWelcomeMessages();
	}, [ fetchWelcomeMessages, selectedSite ] );

	const handleSend = async ( messageToSend?: string ) => {
		const chatMessage = messageToSend || input;
		if ( chatMessage.trim() ) {
			addMessage( chatMessage, 'user', chatId );
			setInput( '' );
			try {
				const { message, chatId: fetchedChatId } = await fetchAssistant(
					chatId,
					[ ...messages, { content: chatMessage, role: 'user' } ],
					currentSiteChatContext
				);
				if ( message ) {
					addMessage( message, 'assistant', chatId ?? fetchedChatId );
				}
			} catch ( error ) {
				setTimeout(
					() =>
						getIpcApi().showMessageBox( {
							type: 'warning',
							message: __( 'Failed to send message' ),
							detail: __( "We couldn't send the latest message. Please try again." ),
							buttons: [ __( 'OK' ) ],
						} ),
					100
				);
			}
		}
	};

	const handleKeyDown = ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => {
		if ( e.key === 'Enter' ) {
			handleSend();
		}
	};

	const clearInput = () => {
		setInput( '' );
		clearMessages();
	};
	const disabled = isOffline || ! isAuthenticated || ! userCanSendMessage;

	return (
		<div className="h-full flex flex-col bg-gray-50">
			<div
				data-testid="assistant-chat"
				className={ cx( 'flex-1 overflow-y-auto p-8', ! isAuthenticated && 'flex items-end' ) }
			>
				{ isAuthenticated ? (
					<>
						<WelcomeComponent
							onExampleClick={ ( prompt ) => handleSend( prompt ) }
							showExamplePrompts={ messages.length === 0 }
							messages={ welcomeMessages }
							examplePrompts={ examplePrompts }
						/>
						<AuthenticatedView
							messages={ messages }
							isAssistantThinking={ isAssistantThinking }
							updateMessage={ updateMessage }
							path={ selectedSite.path }
						/>
					</>
				) : (
					<UnauthenticatedView onAuthenticate={ authenticate } />
				) }
			</div>

			<div className="bg-white flex flex-col">
				<AIInput
					disabled={ disabled }
					input={ input }
					setInput={ setInput }
					handleSend={ () => handleSend() }
					handleKeyDown={ handleKeyDown }
					clearInput={ clearInput }
					isAssistantThinking={ isAssistantThinking }
				/>
				<div className="text-gray-500 self-end p-2">
					{ createInterpolateElement( __( 'Powered by exerimental AI. <a>Learn More.</a>' ), {
						a: <Button variant="link" onClick={ () => getIpcApi().openURL( AI_GUIDELINES_URL ) } />,
					} ) }
				</div>
			</div>
		</div>
	);
}
