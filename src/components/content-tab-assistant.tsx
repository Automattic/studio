import {
	__unstableAnimatePresence as AnimatePresence,
	__unstableMotion as motion,
} from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { AI_GUIDELINES_URL, LIMIT_OF_PROMPTS_PER_USER } from '../constants';
import { useAssistant, Message as MessageType } from '../hooks/use-assistant';
import { useAssistantApi } from '../hooks/use-assistant-api';
import { useAuth } from '../hooks/use-auth';
import { useChatContext } from '../hooks/use-chat-context';
import { useChatInputContext } from '../hooks/use-chat-input';
import { useOffline } from '../hooks/use-offline';
import { usePromptUsage } from '../hooks/use-prompt-usage';
import { useWelcomeMessages } from '../hooks/use-welcome-messages';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import ClearHistoryReminder from './ai-clear-history-reminder';
import { AIInput } from './ai-input';
import { MessageThinking } from './assistant-thinking';
import Button from './button';
import { ChatMessage, MarkDownWithCode } from './chat-message';
import { ChatRating } from './chat-rating';
import offlineIcon from './offline-icon';
import WelcomeComponent from './welcome-message-prompt';

export const MIMIC_CONVERSATION_DELAY = 500;

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

const ErrorNotice = ( {
	submitPrompt,
	messageContent,
}: {
	submitPrompt: ( messageToSend: string, isRetry?: boolean ) => void;
	messageContent: string;
} ) => {
	const { __ } = useI18n();

	return (
		<div className="text-a8c-gray-50 flex justify-end py-2 text-xs">
			{ createInterpolateElement(
				__( "Oops! We couldn't get a response from the assistant. <a>Try again</a>" ),
				{
					a: (
						<Button
							variant="link"
							onClick={ () => submitPrompt( messageContent, true ) }
							className="text-xs !ml-1"
						/>
					),
				}
			) }
		</div>
	);
};

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

type OnUpdateMessageType = (
	id: number,
	codeBlockContent: string,
	cliOutput: string,
	cliStatus: 'success' | 'error',
	cliTime: string
) => void;

interface AuthenticatedViewProps {
	messages: MessageType[];
	isAssistantThinking: boolean;
	updateMessage: OnUpdateMessageType;
	siteId: string;
	submitPrompt: ( messageToSend: string, isRetry?: boolean ) => void;
	markMessageAsFeedbackReceived: ReturnType<
		typeof useAssistant
	>[ 'markMessageAsFeedbackReceived' ];
}

export const AuthenticatedView = memo(
	( {
		messages,
		isAssistantThinking,
		updateMessage,
		siteId,
		submitPrompt,
		markMessageAsFeedbackReceived,
	}: AuthenticatedViewProps ) => {
		const endOfMessagesRef = useRef< HTMLDivElement >( null );
		const lastMessageRef = useRef< HTMLDivElement >( null );
		const [ showThinking, setShowThinking ] = useState( false );
		const lastMessage = useMemo(
			() =>
				showThinking
					? ( { role: 'assistant', id: -1, createdAt: Date.now() } as MessageType )
					: messages[ messages.length - 1 ],
			[ messages, showThinking ]
		);
		const messagesToRender =
			messages[ messages.length - 1 ]?.role === 'assistant' ? messages.slice( 0, -1 ) : messages;
		const showLastMessage = showThinking || messages[ messages.length - 1 ]?.role === 'assistant';
		const previousMessagesLength = useRef( messages?.length );
		const previousSiteId = useRef( siteId );

		useEffect( () => {
			if ( ! messages?.length ) {
				previousSiteId.current = siteId;
				return;
			}

			let timer: NodeJS.Timeout;
			// Scroll to the end of the messages when the tab is opened or site ID changes
			if ( previousMessagesLength.current === 0 || previousSiteId.current !== siteId ) {
				endOfMessagesRef.current?.scrollIntoView( { behavior: 'instant' } );
			}
			// Scroll when a new message is added
			else if ( messages?.length > previousMessagesLength.current || showLastMessage ) {
				// Scroll to the beginning of last message received from the assistant
				if ( showLastMessage ) {
					timer = setTimeout( () => {
						if ( lastMessageRef.current ) {
							lastMessageRef.current.scrollIntoView( { block: 'start', behavior: 'smooth' } );
						}
					}, 400 );
				}
				// For user messages, scroll to the end of the messages
				else {
					endOfMessagesRef.current?.scrollIntoView( { behavior: 'smooth' } );
				}
			}

			previousMessagesLength.current = messages?.length;
			previousSiteId.current = siteId;

			return () => clearTimeout( timer );
		}, [ messages?.length, showLastMessage, siteId ] );

		useEffect( () => {
			let timer: NodeJS.Timeout;
			if ( isAssistantThinking ) {
				timer = setTimeout( () => setShowThinking( true ), MIMIC_CONVERSATION_DELAY );
			} else {
				setShowThinking( false );
			}
			return () => clearTimeout( timer );
		}, [ isAssistantThinking ] );

		const RenderMessage = useCallback(
			( { message }: { message: MessageType } ) => (
				<>
					<ChatMessage
						id={ `message-chat-${ message.id }` }
						message={ message }
						siteId={ siteId }
						updateMessage={ updateMessage }
					>
						{ message.content }
					</ChatMessage>
					{ message.failedMessage && (
						<ErrorNotice submitPrompt={ submitPrompt } messageContent={ message.content } />
					) }
				</>
			),
			[ submitPrompt, siteId, updateMessage ]
		);

		const RenderLastMessage = useCallback(
			( {
				showThinking,
				siteId,
				updateMessage,
				message,
				children,
			}: {
				message: MessageType;
				showThinking: boolean;
				siteId: string;
				updateMessage: OnUpdateMessageType;
				children: React.ReactNode;
			} ) => {
				const thinkingAnimation = {
					initial: { opacity: 0, y: 20 },
					animate: { opacity: 1, y: 0 },
					exit: { opacity: 0, y: -20 },
				};
				const messageAnimation = {
					initial: { opacity: 0, y: 20 },
					animate: { opacity: 1, y: 0 },
				};

				return (
					<>
						<ChatMessage
							ref={ lastMessageRef }
							id={ `message-chat-${ message.id }` }
							message={ message }
							siteId={ siteId }
							updateMessage={ updateMessage }
						>
							<AnimatePresence mode="wait">
								{ showThinking ? (
									<motion.div
										key="thinking"
										initial="initial"
										animate="animate"
										exit="exit"
										variants={ thinkingAnimation }
										transition={ { duration: 0.3 } }
									>
										<MessageThinking />
									</motion.div>
								) : (
									<motion.div
										key="content"
										variants={ messageAnimation }
										transition={ { duration: 0.3 } }
										initial="initial"
										animate="animate"
									>
										<MarkDownWithCode
											message={ message }
											siteId={ siteId }
											updateMessage={ updateMessage }
											content={ message.content }
										/>
										{ children }
									</motion.div>
								) }
							</AnimatePresence>
						</ChatMessage>
					</>
				);
			},
			[]
		);

		if ( messages.length === 0 ) {
			return null;
		}
		return (
			<>
				{ messagesToRender.map( ( message ) => (
					<RenderMessage key={ message.id } message={ message } />
				) ) }
				{ showLastMessage && (
					<RenderLastMessage
						siteId={ siteId }
						updateMessage={ updateMessage }
						message={ lastMessage }
						showThinking={ showThinking }
					>
						<div className="flex justify-end">
							{ !! lastMessage.messageApiId && (
								<ChatRating
									messageApiId={ lastMessage.messageApiId }
									markMessageAsFeedbackReceived={ markMessageAsFeedbackReceived }
									feedbackReceived={ !! lastMessage.feedbackReceived }
								/>
							) }
						</div>
					</RenderLastMessage>
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
		message={ { role: 'user' } as MessageType }
		isUnauthenticated={ true }
	>
		<div data-testid="unauthenticated-header" className="mb-3 a8c-label-semibold">
			{ __( 'Hold up!' ) }
		</div>
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
			{ sprintf(
				__( 'Every account gets %d prompts included for free each month.' ),
				LIMIT_OF_PROMPTS_PER_USER
			) }
		</div>
		<Button variant="primary" onClick={ onAuthenticate }>
			{ __( 'Log in to WordPress.com' ) }
			<Icon className="ltr:ml-1 rtl:mr-1 rtl:scale-x-[-1]" icon={ external } size={ 21 } />
		</Button>
	</ChatMessage>
);

export function ContentTabAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const inputRef = useRef< HTMLTextAreaElement >( null );
	const currentSiteChatContext = useChatContext();
	const { isAuthenticated, authenticate, user } = useAuth();
	const instanceId = user?.id ? `${ user.id }_${ selectedSite.id }` : selectedSite.id;
	const {
		messages,
		addMessage,
		clearMessages,
		updateMessage,
		markMessageAsFailed,
		chatId,
		markMessageAsFeedbackReceived,
	} = useAssistant( instanceId );
	const { userCanSendMessage } = usePromptUsage();
	const { fetchAssistant, isLoading: isAssistantThinking } = useAssistantApi( selectedSite.id );
	const { messages: welcomeMessages, examplePrompts } = useWelcomeMessages();
	const { getChatInput, saveChatInput } = useChatInputContext();
	const [ currentInput, setCurrentInput ] = useState( '' );
	const isOffline = useOffline();
	const { __ } = useI18n();
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );

	// Restore prompt input when site changes
	useEffect( () => {
		setCurrentInput( getChatInput( selectedSite.id ) );
	}, [ selectedSite.id, getChatInput ] );

	// Save prompt input when it changes
	const setInput = useCallback(
		( input: string ) => {
			saveChatInput( input, selectedSite.id );
			setCurrentInput( input );
		},
		[ selectedSite.id, saveChatInput ]
	);

	const submitPrompt = useCallback(
		async ( chatMessage: string, isRetry?: boolean ) => {
			if ( ! chatMessage ) {
				return;
			}
			let messageId;
			if ( chatMessage.trim() ) {
				if ( isRetry ) {
					// If retrying, find the message ID with failedMessage flag
					const failedMessage = messages.find(
						( msg ) => msg.failedMessage && msg.content === chatMessage
					);
					if ( failedMessage ) {
						messageId = failedMessage.id;
						if ( typeof messageId !== 'undefined' ) {
							markMessageAsFailed( messageId, false );
						}
					}
				} else {
					messageId = addMessage( chatMessage, 'user', chatId ); // Get the new message ID
					setInput( '' );
				}
				try {
					const {
						message,
						chatId: fetchedChatId,
						messageApiId,
					} = await fetchAssistant(
						chatId,
						[
							...messages,
							{ id: messageId, content: chatMessage, role: 'user', createdAt: Date.now() },
						],
						currentSiteChatContext
					);
					if ( message ) {
						addMessage( message, 'assistant', chatId ?? fetchedChatId, messageApiId );
					}
				} catch ( error ) {
					if ( typeof messageId !== 'undefined' ) {
						markMessageAsFailed( messageId, true );
					}
				}
			}
		},
		[
			addMessage,
			chatId,
			currentSiteChatContext,
			fetchAssistant,
			markMessageAsFailed,
			messages,
			setInput,
		]
	);

	// Submit prompt input when the user clicks the send button
	const handleSend = useCallback( () => {
		submitPrompt( inputRef.current?.value ?? '' );
		setInput( '' );
	}, [ submitPrompt, setInput ] );

	const handleKeyDown = ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => {
		if ( e.key === 'Enter' ) {
			handleSend();
		}
	};

	const clearConversation = () => {
		setInput( '' );
		clearMessages();
	};

	// We should render only one notice at a time in the bottom area
	const renderNotice = () => {
		if ( isOffline ) {
			return <OfflineModeView />;
		} else if ( isAuthenticated && ! userCanSendMessage ) {
			return <UsageLimitReached />;
		} else if ( isAuthenticated ) {
			return (
				<ClearHistoryReminder lastMessage={ lastMessage } clearConversation={ clearConversation } />
			);
		}
	};

	const disabled = isOffline || ! isAuthenticated || ! userCanSendMessage || hasFailedMessage;

	return (
		<div className="relative min-h-full flex flex-col bg-gray-50">
			<div
				data-testid="assistant-chat"
				className={ cx(
					'min-h-full flex-1 overflow-y-auto p-8 pb-2 flex flex-col-reverse',
					! isAuthenticated && 'flex items-start'
				) }
			>
				<div className="mt-auto w-full">
					{ isAuthenticated ? (
						<>
							<WelcomeComponent
								onExampleClick={ ( prompt ) => {
									submitPrompt( prompt );
									inputRef.current?.focus();
								} }
								showExamplePrompts={ messages.length === 0 }
								messages={ welcomeMessages }
								examplePrompts={ examplePrompts }
								siteId={ selectedSite.id }
								disabled={ disabled }
							/>
							{
								<AuthenticatedView
									messages={ messages }
									isAssistantThinking={ isAssistantThinking }
									updateMessage={ updateMessage }
									markMessageAsFeedbackReceived={ markMessageAsFeedbackReceived }
									siteId={ selectedSite.id }
									submitPrompt={ submitPrompt }
								/>
							}
						</>
					) : (
						! isOffline && <UnauthenticatedView onAuthenticate={ authenticate } />
					) }
					{ renderNotice() }
				</div>
			</div>

			<div className="sticky bottom-0 bg-gray-50/[0.8] backdrop-blur-sm w-full px-8 pt-4 flex items-center">
				<div className="w-full flex flex-col items-center">
					<AIInput
						ref={ inputRef }
						disabled={ disabled }
						input={ currentInput }
						setInput={ setInput }
						handleSend={ handleSend }
						handleKeyDown={ handleKeyDown }
						clearConversation={ clearConversation }
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
