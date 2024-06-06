import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Icon, external, copy, details } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { useAssistant } from '../hooks/use-assistant';
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
	<div className="mt-1 p-4 bg-[#2D3337]">
		<div className="flex justify-between mb-2 font-sans">
			<span className={ status === 'success' ? 'text-[#63CE68]' : 'text-[#E66D6C]' }>
				{ status === 'success' ? 'Success' : 'Error' }
			</span>
			<span className="text-gray-400">{ time }</span>
		</div>
		<pre className="text-white !bg-transparent !mx-0 !px-0">
			<code className="!bg-transparent !mx-0 !px-0">{ output }</code>
		</pre>
	</div>
);

const ActionButton = ( {
	label,
	icon,
	onClick,
}: {
	label: string;
	icon: JSX.Element;
	onClick: () => void;
} ) => (
	<Button
		onClick={ onClick }
		className="mr-2 p-1 text-white rounded flex items-center bg-gray-700 hover:bg-gray-500 hover:text-white font-sans"
	>
		{ icon }
		<span className="ml-1">{ label }</span>
	</Button>
);

export const Message = ( { children, isUser, className }: MessageProps ) => {
	const [ cliOutput, setCliOutput ] = useState< string | null >( null );
	const [ cliStatus, setCliStatus ] = useState< 'success' | 'error' | null >( null );
	const [ cliTime, setCliTime ] = useState< string | null >( null );

	const handleAction = ( action: 'copy' | 'run', content: string ) => {
		if ( action === 'copy' ) {
			// Todo: Implement copy to clipboard
			console.log( 'copy', content );
		} else if ( action === 'run' ) {
			setCliOutput(
				`Installing Jetpack...\nUnpacking the package...\nInstalling the plugin...\nPlugin installed successfully.\nActivating 'jetpack'...\nPlugin 'jetpack' activated.\nSuccess: Installed 1 of 1 plugins.`
			);
			setCliStatus( 'success' );
			setCliTime( 'Completed in 2.3 seconds' );
		}
	};

	const codeRenders = {
		code( {
			node,
			className,
			children,
			...props
		}: {
			node: React.ReactNode;
			className: string;
			children: React.ReactNode;
		} ) {
			const match = /language-(\w+)/.exec( className || '' );
			const content = String( children ).trim();
			return match ? (
				<>
					<div className="p-3">
						<code className={ className } { ...props }>
							{ children }
						</code>
					</div>
					<div className="p-3 mt-1 flex justify-start">
						<ActionButton
							label="Copy"
							icon={ <Icon icon={ copy } size={ 16 } /> }
							onClick={ () => handleAction( 'copy', content ) }
						/>
						<ActionButton
							label="Run"
							// Todo: Update icon to terminal icon
							icon={ <Icon icon={ details } size={ 16 } /> }
							onClick={ () => handleAction( 'run', content ) }
						/>
					</div>
					{ cliOutput && cliStatus && cliTime && (
						<InlineCLI output={ cliOutput } status={ cliStatus } time={ cliTime } />
					) }
				</>
			) : (
				<code className={ className } { ...props }>
					{ children }
				</code>
			);
		},
	};

	return (
		<div className={ cx( 'flex mt-4', isUser ? 'justify-end' : 'justify-start', className ) }>
			<div
				className={ cx(
					'inline-block p-3 rounded-sm border border-gray-300 lg:max-w-[70%] select-text whitespace-pre-wrap',
					! isUser && 'bg-white'
				) }
			>
				{ typeof children === 'string' ? (
					<div className="assistant-markdown">
						<Markdown components={ codeRenders }>{ children }</Markdown>
					</div>
				) : (
					children
				) }
			</div>
		</div>
	);
};

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

	const renderAuthenticatedView = () => (
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
			<div ref={ endOfMessagesRef } />
		</>
	);

	const renderUnauthenticatedView = () => (
		<Message className="w-full" isUser={ false }>
			<p className="mb-1.5 a8c-label-semibold">{ __( 'Hold up!' ) }</p>
			<p>{ __( 'You need to log in to your WordPress.com account to use the assistant.' ) }</p>
			<p className="mb-1.5">
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
			</p>
			<p className="mb-3">
				{ __( 'Every account gets 200 prompts included for free each month.' ) }
			</p>
			<Button variant="primary" onClick={ authenticate }>
				{ __( 'Log in to WordPress.com' ) }
				<Icon className="ltr:ml-1 rtl:mr-1 rtl:scale-x-[-1]" icon={ external } size={ 21 } />
			</Button>
		</Message>
	);

	return (
		<div className="h-full flex flex-col bg-gray-50">
			<div
				data-testid="assistant-chat"
				className={ cx( 'flex-1 overflow-y-auto p-8', ! isAuthenticated && 'flex items-end' ) }
			>
				{ isAuthenticated ? renderAuthenticatedView() : renderUnauthenticatedView() }
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
