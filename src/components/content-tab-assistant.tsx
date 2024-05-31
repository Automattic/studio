import { createInterpolateElement } from '@wordpress/element';
import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import hljs from 'highlight.js';
import React, { useState, useEffect, useRef } from 'react';
import { Remarkable } from 'remarkable';
import { useAssistant } from '../hooks/use-assistant';
import { useAssistantApi } from '../hooks/use-assistant-api';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { MessageThinking } from './assistant-thinking';
import Button from './button';
import { AssistantIcon } from './icons/assistant';
import { MenuIcon } from './icons/menu';
import '../assistant-markdown.css';

const md = new Remarkable( {
	highlight: function ( str, lang ) {
		if ( lang && hljs.getLanguage( lang ) ) {
			try {
				return hljs.highlight( lang, str ).value;
			} catch ( err ) {
				console.error( `Error highlighting with language ${ lang }:`, err );
			}
		}

		try {
			return hljs.highlightAuto( str ).value;
		} catch ( err ) {
			console.error( 'Error highlighting automatically:', err );
		}

		// Fallback to inline code if syntax highlighting fails
		return `<pre><code>${ str }</code></pre>`;
	},
} );

interface SiteDetails {
	name: string;
}

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

interface MessageProps {
	children: React.ReactNode;
	isUser: boolean;
	className?: string;
}

export const Message = ( { children, isUser, className }: MessageProps ) => (
	<div className={ cx( 'flex mb-2 mt-2', isUser ? 'justify-end' : 'justify-start', className ) }>
		<div
			className={ cx(
				'inline-block p-3 rounded-sm border border-gray-300 lg:max-w-[70%] select-text',
				! isUser && 'bg-white'
			) }
		>
			{ typeof children === 'string' ? (
				<div
					id="assistant-markdown"
					dangerouslySetInnerHTML={ { __html: md.render( children ) } }
				/>
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
	const inputRef = useRef< HTMLInputElement >( null );
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
				// A delay is added to avoid the message box being closed by the previous keydown event
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

	const handleKeyDown = ( e: React.KeyboardEvent< HTMLInputElement > ) => {
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

	useEffect( () => {
		if ( isAuthenticated && inputRef.current ) {
			inputRef.current.focus();
		}
	}, [ isAuthenticated ] );

	const disabled = isOffline || ! isAuthenticated;
	return (
		<div className="h-full flex flex-col bg-gray-50">
			<div
				data-testid="assistant-chat"
				className={ cx(
					'flex-1 overflow-y-auto px-8 py-4',
					! isAuthenticated && 'flex items-end'
				) }
			>
				{ isAuthenticated ? (
					<div data-testid="assistant-chat" className="flex-1 overflow-y-auto p-8">
						<div className="text-gray-500 mb-4">
							Welcome to the Studio assistant. I can help manage your site, debug issues, and
							navigate your way around the WordPress ecosystem.
						</div>
						<div>
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
						</div>
					</div>
				) : (
					<Message className="w-full" isUser={ false }>
						<p className="mb-1.5 a8c-label-semibold">{ __( 'Hold up!' ) }</p>
						<p>
							{ __( 'You need to log in to your WordPress.com account to use the assistant.' ) }
						</p>
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
				) }
			</div>
			<div
				data-testid="assistant-input"
				className="px-8 py-6 bg-white flex items-center border-t border-gray-200 sticky bottom-0"
			>
				<div className="relative flex-1">
					<input
						ref={ inputRef }
						disabled={ disabled }
						type="text"
						placeholder="Ask Studio WordPress Assistant"
						className="w-full p-3 rounded-sm border-black border ltr:pl-8 rtl:pr-8 disabled:border-gray-300 disabled:cursor-not-allowed"
						value={ input }
						onChange={ ( e ) => setInput( e.target.value ) }
						onKeyDown={ handleKeyDown }
					/>
					<div className="absolute top-1/2 transform -translate-y-1/2 ltr:left-3 rtl:left-auto rtl:right-3 pointer-events-none">
						<AssistantIcon />
					</div>
				</div>
				<Button
					disabled={ disabled }
					aria-label="menu"
					className="p-2 ml-2 cursor-pointer"
					onClick={ clearInput }
				>
					<MenuIcon />
				</Button>
			</div>
		</div>
	);
}
