import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useRef } from 'react';
import Button from 'src/components/button';
import { useAgentEvents } from 'src/hooks/use-agent-events';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { agentActions, type AgentUIMessage } from 'src/stores/agent-slice';

function AgentTextMessage( { message }: { message: AgentUIMessage & { type: 'assistant-text' } } ) {
	return (
		<div className="px-4 py-2">
			<div className="prose prose-sm max-w-none whitespace-pre-wrap">{ message.text }</div>
		</div>
	);
}

function AgentToolCall( { message }: { message: AgentUIMessage & { type: 'tool-call' } } ) {
	const isRunning = ! message.endTime;
	const elapsed = message.endTime
		? ( ( message.endTime - message.startTime ) / 1000 ).toFixed( 1 )
		: null;

	return (
		<div className="px-4 py-1">
			<div className="flex items-center gap-2 text-sm text-gray-500">
				<span
					className={ cx(
						'inline-block w-2 h-2 rounded-full',
						isRunning && 'bg-yellow-500 animate-pulse',
						! isRunning && message.isError && 'bg-red-500',
						! isRunning && ! message.isError && 'bg-green-500'
					) }
				/>
				<span className="font-medium">{ message.displayName }</span>
				{ message.detail && <span className="text-gray-400">{ message.detail }</span> }
				{ elapsed && <span className="text-gray-400">{ elapsed }s</span> }
			</div>
			{ message.resultPreview && ! isRunning && (
				<details className="mt-1 ml-4">
					<summary className="text-xs text-gray-400 cursor-pointer">Show result</summary>
					<pre className="mt-1 text-xs text-gray-500 bg-gray-100 p-2 rounded overflow-x-auto max-h-48 overflow-y-auto">
						{ message.resultPreview }
					</pre>
				</details>
			) }
		</div>
	);
}

function AgentScreenshot( { message }: { message: AgentUIMessage & { type: 'tool-screenshot' } } ) {
	return (
		<div className="px-4 py-2">
			<img
				src={ `data:${ message.mimeType };base64,${ message.imageData }` }
				alt="Screenshot"
				className="max-w-full rounded border border-gray-200 shadow-sm"
				style={ { maxHeight: '400px' } }
			/>
		</div>
	);
}

function UserPrompt( { message }: { message: AgentUIMessage & { type: 'user-prompt' } } ) {
	return (
		<div className="px-4 py-2 flex justify-end">
			<div className="bg-blue-50 text-gray-800 px-3 py-2 rounded-lg max-w-[80%] whitespace-pre-wrap text-sm">
				{ message.text }
			</div>
		</div>
	);
}

function AgentError( { message }: { message: AgentUIMessage & { type: 'error' } } ) {
	return (
		<div className="px-4 py-2">
			<div className="text-red-600 text-sm bg-red-50 px-3 py-2 rounded">{ message.message }</div>
		</div>
	);
}

function TurnComplete( { message }: { message: AgentUIMessage & { type: 'turn-complete' } } ) {
	return (
		<div className="px-4 py-1 text-center">
			<span className="text-xs text-gray-400">
				{ message.durationSec }s &middot; { message.numTurns } turns &middot; $
				{ message.costUsd.toFixed( 4 ) }
			</span>
		</div>
	);
}

function AgentMessageItem( { message }: { message: AgentUIMessage } ) {
	switch ( message.type ) {
		case 'user-prompt':
			return <UserPrompt message={ message } />;
		case 'assistant-text':
			return <AgentTextMessage message={ message } />;
		case 'tool-call':
			return <AgentToolCall message={ message } />;
		case 'tool-screenshot':
			return <AgentScreenshot message={ message } />;
		case 'error':
			return <AgentError message={ message } />;
		case 'turn-complete':
			return <TurnComplete message={ message } />;
	}
}

function AgentAskUser( {
	questions,
	onAnswer,
}: {
	questions: Array< {
		question: string;
		options: Array< { label: string; description: string } >;
	} >;
	onAnswer: ( answers: Record< string, string > ) => void;
} ) {
	const handleOptionClick = ( question: string, label: string ) => {
		onAnswer( { [ question ]: label } );
	};

	return (
		<div className="px-4 py-2">
			{ questions.map( ( q ) => (
				<div key={ q.question } className="mb-2">
					<p className="text-sm font-medium mb-1">{ q.question }</p>
					<div className="flex gap-2 flex-wrap">
						{ q.options.map( ( opt ) => (
							<Button
								key={ opt.label }
								variant="secondary"
								onClick={ () => handleOptionClick( q.question, opt.label ) }
							>
								{ opt.label }
							</Button>
						) ) }
					</div>
				</div>
			) ) }
		</div>
	);
}

function AgentInput( { selectedSite }: { selectedSite: SiteDetails } ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const inputText = useRootSelector( ( state ) => state.agent.inputText );
	const status = useRootSelector( ( state ) => state.agent.status );
	const currentModel = useRootSelector( ( state ) => state.agent.currentModel );
	const textareaRef = useRef< HTMLTextAreaElement >( null );

	const isProcessing = status === 'thinking' || status === 'tool-running';

	const handleSubmit = useCallback( () => {
		const trimmed = inputText.trim();
		if ( ! trimmed || isProcessing ) {
			return;
		}
		dispatch( agentActions.addUserPrompt( trimmed ) );
		dispatch( agentActions.setInputText( '' ) );

		void getIpcApi().startAgentTurn( trimmed, {
			model: currentModel,
			siteContext: {
				name: selectedSite.name,
				path: selectedSite.path,
				running: selectedSite.running,
			},
		} );
	}, [ inputText, isProcessing, dispatch, currentModel, selectedSite ] );

	const handleKeyDown = useCallback(
		( e: React.KeyboardEvent ) => {
			if ( e.key === 'Enter' && ! e.shiftKey ) {
				e.preventDefault();
				handleSubmit();
			}
		},
		[ handleSubmit ]
	);

	const handleStop = useCallback( () => {
		void getIpcApi().interruptAgent();
	}, [] );

	return (
		<div className="border-t border-gray-200 bg-white p-3">
			<div className="flex items-end gap-2">
				<textarea
					ref={ textareaRef }
					className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					rows={ 1 }
					placeholder={ isProcessing ? __( 'Agent is working…' ) : __( 'Ask the agent anything…' ) }
					value={ inputText }
					onChange={ ( e ) => dispatch( agentActions.setInputText( e.target.value ) ) }
					onKeyDown={ handleKeyDown }
					disabled={ isProcessing }
					style={ { maxHeight: '120px' } }
				/>
				{ isProcessing ? (
					<Button variant="secondary" onClick={ handleStop }>
						{ __( 'Stop' ) }
					</Button>
				) : (
					<Button variant="primary" onClick={ handleSubmit } disabled={ ! inputText.trim() }>
						{ __( 'Send' ) }
					</Button>
				) }
			</div>
			<div className="flex items-center justify-between mt-1">
				<span className="text-xs text-gray-400">
					{ isProcessing
						? status === 'tool-running'
							? __( 'Running tool…' )
							: __( 'Thinking…' )
						: '' }
				</span>
				<button
					className="text-xs text-gray-400 hover:text-gray-600"
					onClick={ () => {
						dispatch( agentActions.clearConversation() );
						void getIpcApi().resetAgentSession();
					} }
				>
					{ __( 'New conversation' ) }
				</button>
			</div>
		</div>
	);
}

export function ContentTabAgent( { selectedSite }: { selectedSite: SiteDetails } ) {
	useAgentEvents();

	const messages = useRootSelector( ( state ) => state.agent.messages );
	const pendingQuestions = useRootSelector( ( state ) => state.agent.pendingQuestions );
	const status = useRootSelector( ( state ) => state.agent.status );
	const dispatch = useAppDispatch();
	const messagesEndRef = useRef< HTMLDivElement >( null );

	// Auto-scroll to bottom when new messages arrive
	useEffect( () => {
		messagesEndRef.current?.scrollIntoView( { behavior: 'smooth' } );
	}, [ messages, pendingQuestions ] );

	const handleAskUserAnswer = useCallback(
		( answers: Record< string, string > ) => {
			dispatch( agentActions.askUserAnswered() );
			void getIpcApi().respondToAgentQuestion( answers );
		},
		[ dispatch ]
	);

	return (
		<div className="flex flex-col h-full bg-white">
			{ /* Message area */ }
			<div className="flex-1 overflow-y-auto" style={ { scrollbarWidth: 'thin' } }>
				{ messages.length === 0 && (
					<div className="flex items-center justify-center h-full text-gray-400 text-sm">
						Start a conversation with the AI agent
					</div>
				) }
				{ messages.map( ( msg, i ) => (
					<AgentMessageItem key={ i } message={ msg } />
				) ) }
				{ pendingQuestions && (
					<AgentAskUser questions={ pendingQuestions } onAnswer={ handleAskUserAnswer } />
				) }
				{ ( status === 'thinking' || status === 'tool-running' ) &&
					messages.length > 0 &&
					messages[ messages.length - 1 ].type !== 'tool-call' && (
						<div className="px-4 py-2 text-sm text-gray-400 animate-pulse">Thinking…</div>
					) }
				<div ref={ messagesEndRef } />
			</div>

			{ /* Input area */ }
			<AgentInput selectedSite={ selectedSite } />
		</div>
	);
}
