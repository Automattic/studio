import { Spinner } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Icon, external, copy } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, memo } from 'react';
import Markdown, { ExtraProps } from 'react-markdown';
import { useAssistant, Message as MessageType } from '../hooks/use-assistant';
import { useAssistantApi } from '../hooks/use-assistant-api';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { AIInput } from './ai-input';
import { MessageThinking } from './assistant-thinking';
import Button from './button';

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

interface MessageProps {
	id: string;
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
			variant="tertiary"
			className="mr-2 font-sans select-none"
			disabled={ disabled }
		>
			{ icon }
			<span className="ml-1">{ buttonLabel }</span>
		</Button>
	);
};

export const Message = ( { children, id, isUser, className }: MessageProps ) => {
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
				id={ id }
				role="group"
				aria-labelledby={ id }
				className={ cx(
					'inline-block p-3 rounded border border-gray-300 lg:max-w-[70%] select-text',
					! isUser ? 'bg-white' : 'bg-white/45'
				) }
			>
				<div className="relative">
					<span className="sr-only">
						{ isUser ? __( 'Your message' ) : __( 'Studio Assistant' ) },
					</span>
				</div>
				{ typeof children === 'string' ? (
					<div className="assistant-markdown">
						<Markdown components={ { code: CodeBlock } }>{ children }</Markdown>
					</div>
				) : (
					children
				) }
			</div>
		</div>
	);
};

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
				<Message key={ index } id={ `message-${ index }` } isUser={ message.role === 'user' }>
					{ message.content }
				</Message>
			) ) }
			{ isAssistantThinking && (
				<Message isUser={ false } id="message-thinking">
					<MessageThinking />
				</Message>
			) }
		</>
	)
);

const UnauthenticatedView = ( { onAuthenticate }: { onAuthenticate: () => void } ) => (
	<Message id="message-unauthenticated" className="w-full" isUser={ false }>
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
	const { messages, addMessage, clearMessages } = useAssistant( selectedSite.name );
	const { fetchAssistant, isLoading: isAssistantThinking } = useAssistantApi();
	const [ input, setInput ] = useState< string >( '' );
	const endOfMessagesRef = useRef< HTMLDivElement >( null );
	const { isAuthenticated, authenticate } = useAuth();
	const isOffline = useOffline();
	const { __ } = useI18n();

	const handleSend = async () => {
		if ( input.trim() ) {
			addMessage( input, 'user' );
			setInput( '' );
			try {
				const { message } = await fetchAssistant( [
					...messages,
					{ content: input, role: 'user' },
				] );
				if ( message ) {
					addMessage( message, 'assistant' );
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

	const disabled = isOffline || ! isAuthenticated;

	return (
		<div className="h-full flex flex-col bg-gray-50">
			<div
				data-testid="assistant-chat"
				className={ cx( 'flex-1 overflow-y-auto p-8', ! isAuthenticated && 'flex items-end' ) }
			>
				{ isAuthenticated ? (
					<>
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
				handleSend={ handleSend }
				handleKeyDown={ handleKeyDown }
				clearInput={ clearInput }
				isAssistantThinking={ isAssistantThinking }
			/>
		</div>
	);
}
