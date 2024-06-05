import { createInterpolateElement } from '@wordpress/element';
import { Icon, external } from '@wordpress/icons';
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

export const Message = ( { children, isUser, className }: MessageProps ) => (
	<div className={ cx( 'flex mt-4', isUser ? 'justify-end' : 'justify-start', className ) }>
		<div
			className={ cx(
				'inline-block p-3 rounded-sm border border-gray-300 lg:max-w-[70%] select-text whitespace-pre-wrap',
				! isUser && 'bg-white'
			) }
		>
			{ typeof children === 'string' ? (
				<div className="assistant-markdown">
					<Markdown>{ children }</Markdown>
				</div>
			) : (
				children
			) }
		</div>
	</div>
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
				className={ cx( 'flex-1 overflow-y-auto py-4', ! isAuthenticated && 'flex items-end' ) }
			>
				<div data-testid="assistant-chat" className="flex-1 overflow-y-auto px-8 py-4">
					{ isAuthenticated ? renderAuthenticatedView() : renderUnauthenticatedView() }
				</div>
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
