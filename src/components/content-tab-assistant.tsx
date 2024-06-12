import { Spinner } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Icon, external, copy } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
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
import { ExecuteIcon } from './icons/execute';

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

interface MessageProps {
	children: React.ReactNode;
	isUser: boolean;
	id?: number;
	className?: string;
	projectPath?: string;
	siteId?: string;
	blocks?: {
		cliOutput?: string;
		cliStatus?: 'success' | 'error';
		cliTime?: string;
		codeBlockContent?: string;
	}[];
	updateMessage?: (
		id: number,
		content: string,
		output: string,
		status: 'success' | 'error',
		time: string
	) => void;
}

interface InlineCLIProps {
	output?: string;
	status?: 'success' | 'error';
	time?: string | null;
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

export const Message = ( {
	children,
	id,
	isUser,
	className,
	projectPath,
	blocks,
	updateMessage,
}: MessageProps ) => {
	const CodeBlock = ( props: JSX.IntrinsicElements[ 'code' ] & ExtraProps ) => {
		const [ cliOutput, setCliOutput ] = useState< string | null >( null );
		const [ cliStatus, setCliStatus ] = useState< 'success' | 'error' | null >( null );
		const [ cliTime, setCliTime ] = useState< string | null >( null );

		const [ isRunning, setIsRunning ] = useState( false );

		const content = String( props.children ).trim();
		const containsWPCommand = /\bwp\s/.test( content );
		const wpCommandCount = ( content.match( /\bwp\s/g ) || [] ).length;
		const containsSingleWPCommand = wpCommandCount === 1;

		useEffect( () => {
			if ( blocks ) {
				const block = blocks?.find( ( block ) => block.codeBlockContent === content );
				if ( block ) {
					setCliOutput( block?.cliOutput ?? null );
					setCliStatus( block?.cliStatus ?? null );
					setCliTime( block?.cliTime ?? null );
				}
			}
		}, [ content ] );

		const handleExecute = useCallback( async () => {
			setIsRunning( true );
			const startTime = Date.now();
			const args = content.split( ' ' ).slice( 1 );
			const result = await getIpcApi().executeWPCLiInline( {
				projectPath: projectPath || '',
				args,
			} );

			setTimeout( () => {
				const msTime = Date.now() - startTime;
				if ( result.stderr ) {
					setCliOutput( result.stderr );
					setCliStatus( 'error' );
				} else {
					setCliOutput( result.stdout );
					setCliStatus( 'success' );
				}
				const completedIn = sprintf(
					__( 'Completed in %s seconds' ),
					( msTime / 1000 ).toFixed( 2 )
				);
				setCliTime( completedIn );
				setIsRunning( false );

				if ( updateMessage && id !== undefined ) {
					updateMessage(
						id,
						content,
						result.stdout || result.stderr,
						result.stderr ? 'error' : 'success',
						completedIn || ''
					);
				}
			}, 2300 );
		}, [ content ] );

		const { children, className } = props;
		const match = /language-(\w+)/.exec( className || '' );
		return match ? (
			<>
				<div className="p-3">
					<code className={ className } { ...props }>
						{ children }
					</code>
				</div>
				<div className="p-3 mt-1 flex justify-start items-center">
					<ActionButton
						primaryLabel={ __( 'Copy' ) }
						secondaryLabel={ __( 'Copied' ) }
						icon={ <Icon icon={ copy } size={ 16 } /> }
						onClick={ () => getIpcApi().copyText( content ) }
						timeout={ 2000 }
					/>
					{ containsWPCommand && containsSingleWPCommand && (
						<ActionButton
							primaryLabel={ __( 'Run' ) }
							secondaryLabel={ __( 'Run Again' ) }
							icon={ <ExecuteIcon /> }
							onClick={ handleExecute }
							disabled={ isRunning }
						/>
					) }
				</div>
				{ isRunning && (
					<div className="p-3 flex justify-start items-center bg-[#2D3337] text-white">
						<Spinner className="!text-white [&>circle]:stroke-a8c-gray-60" />
						<span className="ml-2 font-sans">{ __( 'Running...' ) }</span>
					</div>
				) }
				{ ! isRunning && cliOutput && cliStatus && (
					<InlineCLI output={ cliOutput } status={ cliStatus } time={ cliTime } />
				) }
			</>
		) : (
			<div className="p-3">
				<code className={ className } { ...props }>
					{ children }
				</code>
			</div>
		);
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
						<Markdown components={ { code: CodeBlock } }>{ children }</Markdown>
					</div>
				) : (
					children
				) }
			</div>
		</div>
	);
};

const RenderAuthenticatedView = memo(
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
	} ) => (
		<>
			{ messages.map( ( message, index ) => (
				<Message
					key={ index }
					isUser={ message.role === 'user' }
					projectPath={ path }
					updateMessage={ updateMessage }
					id={ message.id }
					blocks={ message.blocks }
				>
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
export function ContentTabAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const { messages, addMessage, clearMessages, updateMessage } = useAssistant( selectedSite.name );
	const { fetchAssistant, isLoading: isAssistantThinking } = useAssistantApi();
	const [ input, setInput ] = useState< string >( '' );
	const endOfMessagesRef = useRef< HTMLDivElement >( null );
	const { isAuthenticated, authenticate } = useAuth();
	const isOffline = useOffline();
	const { __ } = useI18n();

	const handleSend = useCallback( async () => {
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
	}, [ __, addMessage, fetchAssistant, input, messages ] );

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

	console.log( 'Messages:', messages );

	const renderUnauthenticatedView = () => (
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
				{ isAuthenticated ? (
					<RenderAuthenticatedView
						messages={ messages }
						isAssistantThinking={ isAssistantThinking }
						updateMessage={ updateMessage }
						path={ selectedSite.path }
					/>
				) : (
					renderUnauthenticatedView()
				) }
				<div ref={ endOfMessagesRef } />
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
