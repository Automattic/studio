/** Big Sky Agent Dependencies **/
import {
	useLLM,
	useSimpleChat,
	useSimpleAgentToolkit,
	useAgentExecutor,
	StandardAgent,
	FStringPromptTemplate,
	LLMModel,
	LLMService,
	AgentUI,
	AgentControls,
	LLMControls,
} from '@automattic/big-sky-agents';
import { createInterpolateElement } from '@wordpress/element';
import { Icon, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { MessageThinking } from './assistant-thinking';
import Button from './button';
import { AssistantIcon } from './icons/assistant';
import { MenuIcon } from './icons/menu';

interface ContentTabBigSkyAgentProps {
	selectedSite: SiteDetails;
}

interface MessageProps {
	children: React.ReactNode;
	isUser: boolean;
	className?: string;
}

const Message = ( { children, isUser, className }: MessageProps ) => (
	<div className={ cx( 'flex mb-2 mt-2', isUser ? 'justify-end' : 'justify-start', className ) }>
		<div
			className={ cx(
				'inline-block p-3 rounded-sm border border-gray-300 lg:max-w-[70%] select-text',
				! isUser && 'bg-white'
			) }
		>
			{ children }
		</div>
	</div>
);

const TEMPERATURE = 0.2;
const DEMO_AGENT_ID = 'demo-agent';

const systemPrompt = FStringPromptTemplate.fromString(
	`You are a helpful AI assistant. Your mission is to find out what the user needs, clearly set goal and choose an appropriate agent to help them.`
);

class DemoAgent extends StandardAgent {
	getId() {
		return DEMO_AGENT_ID;
	}

	getSystemPrompt() {
		return systemPrompt;
	}

	onStart() {
		this.askUser( {
			question: 'What can I help you with?',
			choices: [
				// these more-or-less correspond to specific agents
				'Help me finish my site',
				'Copy fonts, colors, content or layout from another site',
				'I want to change my site title or settings',
				'I want to add, edit or remove pages',
				'I want to change the color or fonts of my site',
				'I want to learn about WordPress',
				'I want to understand my stats',
				'I want to build or modify a store',
			],
		} );
	}
}

const AGENTS = [
	{
		id: DEMO_AGENT_ID,
		name: 'Demo Agent',
		description: 'Here to understand your goal and choose the best agent to help you.',
	},
];

export function ContentTabBigSkyAgent( { selectedSite }: ContentTabBigSkyAgentProps ) {
	const { client, isAuthenticated, authenticate } = useAuth();
	const [ service, setService ] = useState( LLMService.OPENAI );
	const [ model, setModel ] = useState( LLMModel.GPT_4O );
	const [ temperature, setTemperature ] = useState( TEMPERATURE );
	const [ token, setToken ] = useState( client?.token );
	// console.log( 'BigSky Agents', BigSkyAgents );
	// console.log( 'BigSky', BigSky );
	// console.warn( 'client', client );

	// set the token value again when the client changes
	useEffect( () => {
		if ( client?.token ) {
			setToken( client?.token );
		}
	}, [ client ] );

	const llm = useLLM( { token, service } );
	const chat = useSimpleChat( {
		llm,
		model,
		temperature,
	} );
	const toolkit = useSimpleAgentToolkit( { agents: AGENTS } );
	const agent = useMemo( () => new DemoAgent( chat, toolkit ), [ chat, toolkit ] );
	useAgentExecutor( { agent, chat, toolkit } );

	// const { messages, addMessage, clearMessages } = useAssistant( selectedSite.name );
	// const { fetchAssistant, isLoading: isAssistantThinking } = useAssistantApi();
	const fakeChat = {
		history: [
			{ content: 'Hello', role: 'assistant' },
			{ content: 'How can I help you?', role: 'assistant' },
		],
	};
	const isAssistantThinking = false;
	const [ input, setInput ] = useState< string >( '' );
	const endOfMessagesRef = useRef< HTMLDivElement >( null );
	const inputRef = useRef< HTMLInputElement >( null );

	const isOffline = useOffline();
	const { __ } = useI18n();

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
							{ fakeChat.history.map( ( message, index ) => (
								<Message key={ index } isUser={ message.role === 'user' }>
									{ Array.isArray( message.content )
										? message.content.map( ( item, idx ) => <span key={ idx }>{ item.text }</span> )
										: message.content }
								</Message>
							) ) }
							{ isAssistantThinking && (
								<Message isUser={ false }>
									<MessageThinking />
								</Message>
							) }
							<div ref={ endOfMessagesRef } />
						</div>
						<AgentUI toolkit={ toolkit } agent={ agent } chat={ chat } />
						<AgentControls toolkit={ toolkit } agent={ agent } chat={ chat } />
						<LLMControls
							token={ token }
							model={ model }
							service={ service }
							temperature={ temperature }
							onTokenChanged={ setToken }
							onModelChanged={ setModel }
							onServiceChanged={ setService }
							onTemperatureChanged={ setTemperature }
						/>
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
		</div>
	);
}
