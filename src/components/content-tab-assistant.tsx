import * as Sentry from '@sentry/react';
import { Spinner } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Icon, external, copy } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, memo } from 'react';
import Markdown, { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAssistant, Message as MessageType } from '../hooks/use-assistant';
import { useAssistantApi } from '../hooks/use-assistant-api';
import { useAuth } from '../hooks/use-auth';
import { useFetchWelcomeMessages } from '../hooks/use-fetch-welcome-messages';
import { useOffline } from '../hooks/use-offline';
import { usePromptUsage } from '../hooks/use-prompt-usage';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { AIInput } from './ai-input';
import { MessageThinking } from './assistant-thinking';
import Button from './button';
import WelcomeComponent from './welcome-message-prompt';

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

interface MessageProps {
	children: React.ReactNode;
	isUser: boolean;
	className?: string;
}

interface InlineCLIProps {
	output: string;
	status: 'success' | 'error';
	time: string;
}

const InlineCLI = ( { output, status, time }: InlineCLIProps ) => (
	<div className="p-3 bg-[#2D3337]">
		<div className="flex justify-between mb-2 font-sans">
			<span className={ status === 'success' ? 'text-[#63CE68]' : 'text-[#E66D6C]' }>
				{ status === 'success' ? __( 'Success' ) : __( 'Error' ) }
			</span>
			<span className="text-gray-400">{ time }</span>
		</div>
		<pre className="text-white !bg-transparent !m-0 !px-0">
			<code className="!bg-transparent !mx-0 !px-0">{ output }</code>
		</pre>
	</div>
);

const ActionButton = ( {
	primaryLabel,
	secondaryLabel,
	icon,
	onClick,
	timeout,
	disabled,
}: {
	primaryLabel: string;
	secondaryLabel: string;
	icon: JSX.Element;
	onClick: () => void;
	timeout?: number;
	disabled?: boolean;
} ) => {
	const [ buttonLabel, setButtonLabel ] = useState( primaryLabel );

	const handleClick = () => {
		onClick();
		setButtonLabel( secondaryLabel );
		if ( timeout ) {
			setTimeout( () => {
				setButtonLabel( primaryLabel );
			}, timeout );
		}
	};

	return (
		<Button
			onClick={ handleClick }
			variant="outlined"
			className="h-auto mr-2 !px-2.5 py-0.5 font-sans select-none"
			disabled={ disabled }
		>
			{ icon }
			<span className="ml-1">{ buttonLabel }</span>
		</Button>
	);
};

export const Message = ( { children, isUser, className }: MessageProps ) => {
	const [ cliOutput, setCliOutput ] = useState< string | null >( null );
	const [ cliStatus, setCliStatus ] = useState< 'success' | 'error' | null >( null );
	const [ cliTime, setCliTime ] = useState< string | null >( null );
	const [ isRunning, setIsRunning ] = useState( false );

	const handleExecute = () => {
		setIsRunning( true );
		setTimeout( () => {
			setCliOutput(
				`Installing Jetpack...\nUnpacking the package...\nInstalling the plugin...\nPlugin installed successfully.\nActivating 'jetpack'...\nPlugin 'jetpack' activated.\nSuccess: Installed 1 of 1 plugins.`
			);
			setCliStatus( 'success' );
			setCliTime( 'Completed in 2.3 seconds' );
			setIsRunning( false );
		}, 2300 );
	};

	const CodeBlock = ( props: JSX.IntrinsicElements[ 'code' ] & ExtraProps ) => {
		const { children, className } = props;
		const match = /language-(\w+)/.exec( className || '' );
		const content = String( children ).trim();

		return match ? (
			<>
				<div className="p-3">
					<code className={ className } { ...props }>
						{ children }
					</code>
				</div>
				<div className="p-3 pt-1 flex justify-start items-center">
					<ActionButton
						primaryLabel={ __( 'Copy' ) }
						secondaryLabel={ __( 'Copied' ) }
						icon={ <Icon icon={ copy } size={ 16 } /> }
						onClick={ () => getIpcApi().copyText( content ) }
						timeout={ 2000 }
					/>
					{ /* <ActionButton
						primaryLabel={ __( 'Run' ) }
						secondaryLabel={ __( 'Run Again' ) }
						icon={ <ExecuteIcon /> }
						onClick={ handleExecute }
						disabled={ isRunning } */ }
				</div>
				{ isRunning && (
					<div className="p-3 flex justify-start items-center bg-[#2D3337] text-white">
						<Spinner className="!text-white [&>circle]:stroke-a8c-gray-60" />
						<span className="ml-2 font-sans">{ __( 'Running...' ) }</span>
					</div>
				) }
				{ ! isRunning && cliOutput && cliStatus && cliTime && (
					<InlineCLI output={ cliOutput } status={ cliStatus } time={ cliTime } />
				) }
			</>
		) : (
			<div className="inline-block">
				<code className={ className } { ...props }>
					{ children }
				</code>
			</div>
		);
	};

	return (
		<div
			className={ cx(
				'flex mt-4',
				isUser ? 'justify-end md:ml-24' : 'justify-start md:mr-24',
				className
			) }
		>
			<div
				className={ cx(
					'inline-block p-3 rounded border border-gray-300 lg:max-w-[70%] overflow-x-auto select-text',
					! isUser ? 'bg-white' : 'bg-white/45'
				) }
			>
				{ typeof children === 'string' ? (
					<div className="assistant-markdown">
						<Markdown components={ { a: Anchor, code: CodeBlock } } remarkPlugins={ [ remarkGfm ] }>
							{ children }
						</Markdown>
					</div>
				) : (
					children
				) }
			</div>
		</div>
	);
};

function Anchor( props: JSX.IntrinsicElements[ 'a' ] & ExtraProps ) {
	const { href } = props;

	return (
		<a
			{ ...props }
			onClick={ ( e ) => {
				if ( ! href ) {
					return;
				}

				e.preventDefault();
				try {
					getIpcApi().openURL( href );
				} catch ( error ) {
					getIpcApi().showMessageBox( {
						type: 'error',
						message: __( 'Failed to open link' ),
						detail: __( 'We were unable to open the link. Please try again.' ),
						buttons: [ __( 'OK' ) ],
					} );
					Sentry.captureException( error );
				}
			} }
		/>
	);
}

const AuthenticatedView = memo(
	( {
		messages,
		isAssistantThinking,
	}: {
		messages: MessageType[];
		isAssistantThinking: boolean;
	} ) => (
		<>
			{ messages.map( ( message, index ) => (
				<Message key={ index } isUser={ message.role === 'user' }>
					{ message.content }
				</Message>
			) ) }
			{ isAssistantThinking && (
				<Message isUser={ false }>
					<MessageThinking />
				</Message>
			) }
		</>
	)
);

const UnauthenticatedView = ( { onAuthenticate }: { onAuthenticate: () => void } ) => (
	<Message className="w-full" isUser={ false }>
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
	</Message>
);

export function ContentTabAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const { messages, addMessage, chatId, clearMessages } = useAssistant( selectedSite.name );
	const { userCanSendMessage } = usePromptUsage();
	const { fetchAssistant, isLoading: isAssistantThinking } = useAssistantApi();
	const {
		messages: welcomeMessages,
		examplePrompts,
		fetchWelcomeMessages,
	} = useFetchWelcomeMessages();
	const [ input, setInput ] = useState< string >( '' );
	const endOfMessagesRef = useRef< HTMLDivElement >( null );
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
				const { message, chatId: fetchedChatId } = await fetchAssistant( chatId, [
					...messages,
					{ content: chatMessage, role: 'user' },
				] );
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

	useEffect( () => {
		if ( endOfMessagesRef.current ) {
			endOfMessagesRef.current.scrollIntoView( { behavior: 'smooth' } );
		}
	}, [ messages ] );

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
						<AuthenticatedView messages={ messages } isAssistantThinking={ isAssistantThinking } />
						<div ref={ endOfMessagesRef } />
					</>
				) : (
					<UnauthenticatedView onAuthenticate={ authenticate } />
				) }
			</div>
			<AIInput
				disabled={ disabled }
				input={ input }
				setInput={ setInput }
				handleSend={ () => handleSend() }
				handleKeyDown={ handleKeyDown }
				clearInput={ clearInput }
				isAssistantThinking={ isAssistantThinking }
			/>
		</div>
	);
}
