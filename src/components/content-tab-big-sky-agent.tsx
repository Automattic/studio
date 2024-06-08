/** Big Sky Agent Dependencies **/
import {
	useChatModel,
	useSimpleChat,
	useSimpleAgentToolkit,
	useAgentExecutor,
	StandardAgent,
	FStringPromptTemplate,
	ChatModelType,
	ChatModelService,
	AgentUI,
	AgentControls,
	ChatModelControls,
} from '@automattic/big-sky-agents';
import { createInterpolateElement } from '@wordpress/element';
import { Icon, external, bug } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, useMemo, Dispatch, SetStateAction } from 'react';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { MessageThinking } from './assistant-thinking';
import Button from './button';

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
			choices: [ 'Help me build a plugin', 'Help me choose a theme' ],
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
	const [ controlsVisible, setControlsVisible ] = useState( false );
	const { client, isAuthenticated, authenticate } = useAuth();
	const [ service, setService ] = useState( ChatModelService.WPCOM_OPENAI );
	const [ model, setModel ] = useState( ChatModelType.GPT_4O );
	const [ temperature, setTemperature ] = useState( TEMPERATURE );
	const [ token, setToken ] = useState( client?.token );

	// set the token value again when the client changes
	useEffect( () => {
		if ( client?.token ) {
			setToken( client?.token );
		}
	}, [ client ] );

	const chat = useSimpleChat( {
		service,
		token,
		model,
		temperature,
		feature: 'studio-assistant',
	} );
	const toolkit = useSimpleAgentToolkit( { agents: AGENTS } );
	const agent = useMemo( () => new DemoAgent( chat, toolkit ), [ chat, toolkit ] );
	useAgentExecutor( { agent, chat, toolkit } );

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
					<div className="flex-1 overflow-y-auto p-8">
						<AgentUI toolkit={ toolkit } agent={ agent } chat={ chat } />
						<div className="assistant-debug">
							{ controlsVisible && (
								<>
									<AgentControls toolkit={ toolkit } agent={ agent } chat={ chat } />
									<ChatModelControls
										token={ token ?? '' }
										model={ model }
										service={ service }
										temperature={ temperature ?? TEMPERATURE }
										onTokenChanged={ setToken }
										onModelChanged={ setModel as Dispatch< SetStateAction< string > > }
										onServiceChanged={ setService as Dispatch< SetStateAction< string > > }
										onTemperatureChanged={ setTemperature }
									/>
								</>
							) }
							<div style={ { textAlign: 'right' } }>
								<Button
									icon={ <Icon icon={ bug } /> }
									onClick={ () => setControlsVisible( ( v ) => ! v ) }
								/>
							</div>
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
		</div>
	);
}
