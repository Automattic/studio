import { createInterpolateElement } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
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
import ClearHistoryReminder from './ai-clear-history-reminder';
import { AIInput } from './ai-input';
import { MessageThinking } from './assistant-thinking';
import Button from './button';
import { ChatMessage } from './chat-message';
import offlineIcon from './offline-icon';
import WelcomeComponent from './welcome-message-prompt';

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

const UsageLimitReached = () => {
	const { daysUntilReset } = usePromptUsage();

	// Determine if the reset is today
	const resetMessage =
		daysUntilReset <= 0
			? __( "You've reached your <a>usage limit</a> for this month. Your limit will reset today." )
			: sprintf(
					_n(
						"You've reached your <a>usage limit</a> for this month. Your limit will reset in %s day.",
						"You've reached your <a>usage limit</a> for this month. Your limit will reset in %s days.",
						daysUntilReset
					),
					daysUntilReset
			  );

	return (
		<div className="text-center h-12 px-2 pt-6 text-a8c-gray-70">
			{ createInterpolateElement( resetMessage, {
				a: <Button onClick={ () => getIpcApi().showUserSettings() } variant="link" />,
			} ) }
		</div>
	);
};

const OfflineModeView = () => {
	const offlineMessage = __( 'The AI assistant requires an internet connection.' );

	return (
		<div className="flex items-center justify-center h-12 px-2 pt-4 text-a8c-gray-70 gap-1">
			<Icon className="m-1 fill-a8c-gray-70" size={ 24 } icon={ offlineIcon } />
			<span className="text-[13px] leading-[16px]">{ offlineMessage }</span>
		</div>
	);
};

const ErrorNotice = ( {
	handleSend,
	messageContent,
	messageId,
}: {
	handleSend: ( messageToSend?: string, messageId?: number ) => void;
	messageContent: string;
	messageId: number;
} ) => {
	const { __ } = useI18n();
	return (
		<div className="flex justify-end h-12 px-2 pt-6 text-a8c-gray-70">
			{ createInterpolateElement(
				__( "Oops. We couldn't get a response from the assistant. <a>Try again</a>" ),
				{
					a: <Button variant="link" onClick={ () => handleSend( messageContent, messageId ) } />,
				}
			) }
		</div>
	);
};

const AuthenticatedView = memo(
	( {
		messages,
		isAssistantThinking,
		updateMessage,
		path,
		errorMessageId,
		handleSend,
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
		errorMessageId: number | null;
		handleSend: ( messageToSend?: string, messageId?: number ) => void;
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
					<div key={ index }>
						<ChatMessage
							id={ `message-chat-${ index }` }
							isUser={ message.role === 'user' }
							projectPath={ path }
							updateMessage={ updateMessage }
							messageId={ message.id }
							blocks={ message.blocks }
						>
							{ message.content }
						</ChatMessage>
						{ message.id === errorMessageId && (
							<ErrorNotice
								handleSend={ handleSend }
								messageContent={ message.content }
								messageId={ message.id }
							/>
						) }
					</div>
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
	<ChatMessage
		id="message-unauthenticated"
		className="w-full"
		isUser={ false }
		isUnauthenticated={ true }
	>
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
	const { isAuthenticated, authenticate, user } = useAuth();
	const { messages, addMessage, clearMessages, updateMessage, chatId } = useAssistant(
		user?.id ? `${ user.id }_${ selectedSite.id }` : selectedSite.id
	);
	const { userCanSendMessage } = usePromptUsage();
	const { fetchAssistant, isLoading: isAssistantThinking } = useAssistantApi( selectedSite.id );
	const {
		messages: welcomeMessages,
		examplePrompts,
		fetchWelcomeMessages,
	} = useFetchWelcomeMessages();
	const [ input, setInput ] = useState< string >( '' );
	const isOffline = useOffline();
	const { __ } = useI18n();
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];

	const [ errorMessageId, setErrorMessageId ] = useState< number | null >( null );

	useEffect( () => {
		fetchWelcomeMessages();
	}, [ fetchWelcomeMessages, selectedSite ] );

	const [ isThinking, setIsThinking ] = useState( false ); // Add this line

	const handleSend = async ( messageToSend?: string, messageId?: number ) => {
		const chatMessage = messageToSend || input;
		if ( chatMessage.trim() ) {
			const newMessageId = messageId ?? messages.length;
			if ( messageId === undefined ) {
				addMessage( chatMessage, 'user', chatId );
			}
			setInput( '' );
			setIsThinking( true );
			setErrorMessageId( null );
			try {
				const { message, chatId: fetchedChatId } = await fetchAssistant(
					chatId,
					[
						...messages,
						{ content: chatMessage, role: 'user', createdAt: Date.now(), id: newMessageId },
					],
					currentSiteChatContext
				);
				if ( message ) {
					addMessage( message, 'assistant', chatId ?? fetchedChatId );
				}
			} catch ( error ) {
				setErrorMessageId( newMessageId );
			} finally {
				setIsThinking( false );
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
		<div className="h-full flex flex-col bg-gray-50 relative">
			<div
				data-testid="assistant-chat"
				className={ cx(
					'flex-1 overflow-y-auto p-8 flex flex-col-reverse',
					! isAuthenticated
						? isOffline
							? 'flex items-center justify-center'
							: 'flex items-start'
						: ''
				) }
			>
				<div className="mt-auto">
					{ isOffline ? (
						<>
							{ isAuthenticated && messages.length > 0 && (
								<AuthenticatedView
									messages={ messages }
									isAssistantThinking={ isAssistantThinking }
									updateMessage={ updateMessage }
									path={ selectedSite.path }
									errorMessageId={ errorMessageId }
									handleSend={ handleSend }
								/>
							) }
							<OfflineModeView />
						</>
					) : isAuthenticated ? (
						<>
							{ ! userCanSendMessage ? (
								messages.length > 0 ? (
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
											errorMessageId={ errorMessageId }
											handleSend={ handleSend }
										/>
										<UsageLimitReached />
									</>
								) : (
									<UsageLimitReached />
								)
							) : (
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
										errorMessageId={ errorMessageId }
										handleSend={ handleSend }
									/>
									<ClearHistoryReminder lastMessage={ lastMessage } clearInput={ clearInput } />
								</>
							) }
						</>
					) : (
						<UnauthenticatedView onAuthenticate={ authenticate } />
					) }
				</div>
			</div>

			<div
				className={ cx(
					`bg-gray-50 w-full px-8 pt-5 flex items-center border-0 border-t ${
						disabled ? 'border-top-a8c-gray-10' : 'border-top-gray-200'
					}`
				) }
			>
				<div className="w-full flex flex-col items-center">
					<AIInput
						disabled={ disabled }
						input={ input }
						setInput={ setInput }
						handleSend={ () => handleSend() }
						handleKeyDown={ handleKeyDown }
						clearInput={ clearInput }
						isAssistantThinking={ isAssistantThinking }
					/>
					<div data-testid="guidelines-link" className="text-a8c-gray-50 self-end py-2">
						{ createInterpolateElement( __( 'Powered by experimental AI. <a>Learn more</a>' ), {
							a: (
								<Button variant="link" onClick={ () => getIpcApi().openURL( AI_GUIDELINES_URL ) } />
							),
						} ) }
					</div>
				</div>
			</div>
		</div>
	);
}
