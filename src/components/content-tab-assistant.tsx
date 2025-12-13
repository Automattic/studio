import {
	__unstableAnimatePresence as AnimatePresence,
	__unstableMotion as motion,
} from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, memo, useCallback, useMemo, forwardRef } from 'react';
import ClearHistoryReminder from 'src/components/ai-clear-history-reminder';
import { AIInput } from 'src/components/ai-input';
import { ArrowIcon } from 'src/components/arrow-icon';
import { MessageThinking } from 'src/components/assistant-thinking';
import Button from 'src/components/button';
import { ChatMessage, MarkDownWithCode } from 'src/components/chat-message';
import { ChatRating } from 'src/components/chat-rating';
import offlineIcon from 'src/components/offline-icon';
import WelcomeComponent from 'src/components/welcome-message-prompt';
import { AI_GUIDELINES_URL, LIMIT_OF_PROMPTS_PER_USER } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	chatThunks,
	generateMessage,
	Message as MessageType,
	chatActions,
	chatSelectors,
} from 'src/stores/chat-slice';
import { useGetAssistantQuota, useGetWelcomeMessages } from 'src/stores/wpcom-api';

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
	const { data: assistantQuota } = useGetAssistantQuota();
	const daysUntilReset = assistantQuota?.daysUntilReset ?? 0;

	// Determine if the reset is today
	const resetMessage =
		daysUntilReset <= 0
			? __( "You've reached your <a>usage limit</a> for this month. Your limit will reset today." )
			: sprintf(
					_n(
						"You've reached your <a>usage limit</a> for this month. Your limit will reset in %d day.",
						"You've reached your <a>usage limit</a> for this month. Your limit will reset in %d days.",
						daysUntilReset
					),
					daysUntilReset
			  );

	return (
		<div className="text-center h-12 px-2 pt-6 text-a8c-gray-70">
			{ createInterpolateElement( resetMessage, {
				a: <Button onClick={ () => getIpcApi().showUserSettings( 'usage' ) } variant="link" />,
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

const LastMessage = forwardRef<
	HTMLDivElement,
	React.PropsWithChildren< {
		instanceId: string;
		message: MessageType;
		showThinking: boolean;
		siteId: string;
	} >
>( ( { children, instanceId, message, showThinking, siteId }, ref ) => {
	const [ isInitialRender, setIsInitialRender ] = useState( true );

	useEffect( () => {
		if ( isInitialRender ) {
			setIsInitialRender( false );
		}
	}, [ isInitialRender ] );

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
		<ChatMessage
			ref={ ref }
			id={ `message-chat-${ message.id }` }
			message={ message }
			siteId={ siteId }
			instanceId={ instanceId }
		>
			<AnimatePresence mode="wait">
				{ showThinking ? (
					<motion.div
						key="thinking"
						initial={ isInitialRender ? 'animate' : 'initial' }
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
						initial={ isInitialRender ? 'animate' : 'initial' }
						variants={ messageAnimation }
						transition={ { duration: 0.3 } }
						animate="animate"
					>
						<MarkDownWithCode
							message={ message }
							siteId={ siteId }
							instanceId={ instanceId }
							content={ message.content }
						/>
						{ children }
					</motion.div>
				) }
			</AnimatePresence>
		</ChatMessage>
	);
} );

interface AuthenticatedViewProps {
	messages: MessageType[];
	instanceId: string;
	isAssistantThinking: boolean;
	siteId: string;
	submitPrompt: ( messageToSend: string, isRetry?: boolean ) => void;
	wrapperRef: React.RefObject< HTMLDivElement >;
}

const AuthenticatedView = memo(
	( {
		messages,
		instanceId,
		isAssistantThinking,
		siteId,
		submitPrompt,
		wrapperRef,
	}: AuthenticatedViewProps ) => {
		const lastMessageRef = useRef< HTMLDivElement >( null );
		const [ showThinking, setShowThinking ] = useState( isAssistantThinking );
		const lastMessage = useMemo(
			() =>
				showThinking
					? ( { role: 'assistant', id: -1, createdAt: 0 } as MessageType )
					: messages[ messages.length - 1 ],
			[ messages, showThinking ]
		);
		const messagesToRender =
			messages[ messages.length - 1 ]?.role === 'assistant' ? messages.slice( 0, -1 ) : messages;
		const showLastMessage = lastMessage?.role === 'assistant';
		const previousMessagesLength = useRef( messages.length );
		const isInitialRenderRef = useRef( true );

		// This effect may run twice when the component is mounted, which makes the viewport scroll
		// to the wrong position. This happens because the app runs in React strict mode, meaning
		// it only affects the development environment. For more details, see
		// https://github.com/Automattic/studio/pull/788#issuecomment-2586644007
		useEffect( () => {
			if ( ! messages.length ) {
				return;
			}

			let timer: NodeJS.Timeout;
			// Scroll to the end of the messages when the tab is opened or site ID changes
			if ( isInitialRenderRef.current ) {
				wrapperRef.current?.scrollIntoView( { block: 'end', behavior: 'instant' } );
				isInitialRenderRef.current = false;
			}
			// Scroll when a new message is added
			else if ( messages.length > previousMessagesLength.current || showLastMessage ) {
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
					wrapperRef.current?.scrollIntoView( { block: 'end', behavior: 'smooth' } );
				}
			}

			previousMessagesLength.current = messages.length;

			return () => clearTimeout( timer );
		}, [ messages.length, showLastMessage, wrapperRef ] );

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
						instanceId={ instanceId }
					>
						{ message.content }
					</ChatMessage>
					{ message.failedMessage && (
						<ErrorNotice submitPrompt={ submitPrompt } messageContent={ message.content } />
					) }
				</>
			),
			[ submitPrompt, siteId, instanceId ]
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
					<LastMessage
						instanceId={ instanceId }
						message={ lastMessage }
						ref={ lastMessageRef }
						showThinking={ showThinking }
						siteId={ siteId }
					>
						<div className="flex justify-end">
							{ !! lastMessage.messageApiId && (
								<ChatRating
									instanceId={ instanceId }
									messageApiId={ lastMessage.messageApiId }
									feedbackReceived={ !! lastMessage.feedbackReceived }
								/>
							) }
						</div>
					</LastMessage>
				) }
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
		instanceId=""
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
					a: <Button variant="link" onClick={ () => getIpcApi().authenticate( true ) } />,
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
			<ArrowIcon />
		</Button>
	</ChatMessage>
);

export function ContentTabAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const inputRef = useRef< HTMLTextAreaElement >( null );
	const wrapperRef = useRef< HTMLDivElement >( null );
	const dispatch = useAppDispatch();
	const chatInput = useRootSelector( ( state ) =>
		chatSelectors.selectChatInput( state, selectedSite.id )
	);
	const { isAuthenticated, authenticate, user, client } = useAuth();
	const instanceId = user?.id ? `${ user.id }_${ selectedSite.id }` : selectedSite.id;
	const chatApiId = useRootSelector( ( state ) =>
		chatSelectors.selectChatApiId( state, instanceId )
	);
	const messages = useRootSelector( ( state ) =>
		chatSelectors.selectMessages( state, instanceId )
	);
	const isAssistantThinking = useRootSelector( ( state ) =>
		chatSelectors.selectIsLoading( state, instanceId )
	);
	const { data: assistantQuota } = useGetAssistantQuota();
	const userCanSendMessage = assistantQuota?.userCanSendMessage ?? true;
	const isOffline = useOffline();
	const { __ } = useI18n();
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );
	const { data, isLoading } = useGetWelcomeMessages();

	const { selectedThemeDetails: themeDetails } = useThemeDetails();

	useEffect( () => {
		void dispatch( chatThunks.updateFromSite( { site: selectedSite } ) );
		// Only re-fetch when the site ID changes, not when other site properties change
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ dispatch, selectedSite.id ] );

	useEffect( () => {
		if ( themeDetails ) {
			dispatch( chatActions.updateFromTheme( themeDetails ) );
		}
	}, [ dispatch, themeDetails ] );

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			if ( ! chatMessage || ! client ) {
				return;
			}

			if ( ! isRetry ) {
				dispatch( chatActions.setChatInput( { siteId: selectedSite.id, input: '' } ) );
			}

			const newMessageId = isRetry ? messages.length - 1 : messages.length;
			const message = generateMessage( chatMessage, 'user', newMessageId, chatApiId );

			void dispatch(
				chatThunks.fetchAssistant( {
					client,
					instanceId,
					isRetry,
					message,
					siteId: selectedSite.id,
				} )
			);
		},
		[ client, dispatch, instanceId, selectedSite.id, messages, chatApiId ]
	);

	const clearConversation = () => {
		dispatch( chatActions.setChatInput( { siteId: selectedSite.id, input: '' } ) );
		dispatch( chatActions.setMessages( { instanceId, messages: [] } ) );
		dispatch( chatActions.setChatApiId( { instanceId, chatApiId: undefined } ) );
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
		<div className="relative min-h-full flex flex-col" ref={ wrapperRef }>
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
								messages={ data?.messages ?? [] }
								examplePrompts={ data?.example_prompts ?? [] }
								siteId={ selectedSite.id }
								disabled={ disabled }
								isLoading={ isLoading }
							/>

							<AuthenticatedView
								messages={ messages }
								isAssistantThinking={ isAssistantThinking }
								instanceId={ instanceId }
								siteId={ selectedSite.id }
								submitPrompt={ submitPrompt }
								wrapperRef={ wrapperRef }
							/>
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
						input={ chatInput }
						setInput={ ( input ) => {
							dispatch( chatActions.setChatInput( { siteId: selectedSite.id, input } ) );
						} }
						handleSend={ () => {
							submitPrompt( inputRef.current?.value ?? '' );
						} }
						handleKeyDown={ ( event ) => {
							if ( event.key === 'Enter' ) {
								submitPrompt( inputRef.current?.value ?? '' );
							}
						} }
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
