import {
	SelectControl,
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
import { LearnMoreLink } from 'src/components/learn-more';
import offlineIcon from 'src/components/offline-icon';
import WelcomeComponent from 'src/components/welcome-message-prompt';
import { LIMIT_OF_PROMPTS_PER_USER, TELEX_HOSTNAME, TELEX_UTM_PARAMS } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { addUrlParams } from 'src/lib/url-utils';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	chatThunks,
	generateMessage,
	Message as MessageType,
	chatActions,
	chatSelectors,
} from 'src/stores/chat-slice';
import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';
import { useGetAssistantQuota, useGetWelcomeMessages } from 'src/stores/wpcom-api';
import type { WPCOM } from 'wpcom/types';

export const MIMIC_CONVERSATION_DELAY = 500;
const DOLLY_AGENT_ID = 'dolly';
const DOLLY_HISTORY_CLIENT = 'wpworkspace';

type DollySite = {
	id: number;
	name: string;
	url?: string;
	slug?: string;
};

type DollyAgentResponse = {
	text: string;
	sessionId?: string;
	taskId: string;
	state: string;
};

type AgentResponsePart = {
	type?: string;
	text?: string;
	data?: {
		toolCallId?: string;
		tool_call_id?: string;
		toolId?: string;
		tool_id?: string;
	};
};

const isRecord = ( value: unknown ): value is Record< string, unknown > =>
	typeof value === 'object' && value !== null;

const flexibleNumber = ( value: unknown ): number | undefined => {
	if ( typeof value === 'number' ) {
		return value;
	}
	if ( typeof value === 'string' ) {
		const parsed = Number( value );
		return Number.isFinite( parsed ) ? parsed : undefined;
	}
	return undefined;
};

const parseDollySites = ( response: unknown ): DollySite[] => {
	if ( ! isRecord( response ) || ! Array.isArray( response.sites ) ) {
		throw new Error( 'Invalid Dolly sites response' );
	}

	return response.sites
		.map< DollySite | undefined >( ( site ) => {
			if ( ! isRecord( site ) ) {
				return undefined;
			}

			const id =
				flexibleNumber( site.ID ) ?? flexibleNumber( site.blog_id ) ?? flexibleNumber( site.id );
			if ( ! id ) {
				return undefined;
			}

			const name = typeof site.name === 'string' ? site.name : '';
			const url = typeof site.URL === 'string' ? site.URL : undefined;
			const primaryDomain =
				typeof site.primary_domain === 'string' ? site.primary_domain : undefined;
			const slug = typeof site.slug === 'string' ? site.slug : primaryDomain;
			const dollySite: DollySite = {
				id,
				name: name.trim() || slug || url || String( id ),
			};

			if ( url || primaryDomain ) {
				dollySite.url = url || primaryDomain;
			}
			if ( slug ) {
				dollySite.slug = slug;
			}

			return dollySite;
		} )
		.filter( ( site ): site is DollySite => Boolean( site ) );
};

const wpcomGet = async < T, >( client: WPCOM, path: string ): Promise< T > =>
	new Promise( ( resolve, reject ) => {
		void client.req.get(
			{
				path,
				apiNamespace: 'wpcom/v2',
			},
			( error: Error | null, data: unknown ) => {
				if ( error ) {
					reject( error );
					return;
				}
				resolve( data as T );
			}
		);
	} );

const wpcomPost = async < T, >( client: WPCOM, path: string, body: unknown ): Promise< T > =>
	new Promise( ( resolve, reject ) => {
		void client.req.post(
			{
				path,
				apiNamespace: 'wpcom/v2',
				body,
			},
			( error: Error | null, data: unknown ) => {
				if ( error ) {
					reject( error );
					return;
				}
				resolve( data as T );
			}
		);
	} );

const extractResponseParts = ( response: unknown ): AgentResponsePart[] => {
	if ( ! isRecord( response ) || ! isRecord( response.result ) ) {
		return [];
	}
	const status = response.result.status;
	if (
		! isRecord( status ) ||
		! isRecord( status.message ) ||
		! Array.isArray( status.message.parts )
	) {
		return [];
	}

	return status.message.parts.filter( isRecord ) as AgentResponsePart[];
};

const parseDollyAgentResponse = (
	response: unknown,
	fallbackTaskId: string
): DollyAgentResponse => {
	if ( isRecord( response ) && isRecord( response.error ) ) {
		const message =
			typeof response.error.message === 'string'
				? response.error.message
				: 'Dolly returned an error.';
		throw new Error( message );
	}
	if (
		! isRecord( response ) ||
		! isRecord( response.result ) ||
		! isRecord( response.result.status )
	) {
		throw new Error( 'Invalid Dolly response' );
	}

	const parts = extractResponseParts( response );
	const text = parts
		.filter( ( part ) => part.type === 'text' && typeof part.text === 'string' )
		.map( ( part ) => part.text )
		.join( '\n' )
		.trim();
	const toolCalls = parts.filter(
		( part ) =>
			part.type === 'data' &&
			isRecord( part.data ) &&
			( part.data.toolCallId || part.data.tool_call_id ) &&
			( part.data.toolId || part.data.tool_id )
	);

	const fallbackText =
		toolCalls.length > 0
			? __(
					'Dolly asked Studio to run a frontend tool, but this Studio integration only supports text chat right now.'
			  )
			: __( 'Dolly did not return a text response.' );

	return {
		text: text || fallbackText,
		sessionId:
			typeof response.result.sessionId === 'string' ? response.result.sessionId : undefined,
		taskId: typeof response.result.id === 'string' ? response.result.id : fallbackTaskId,
		state:
			typeof response.result.status.state === 'string' ? response.result.status.state : 'unknown',
	};
};

const createDollyClientContext = ( siteId: number, selectedSite: SiteDetails ) => ( {
	constructorArguments: {
		client: DOLLY_HISTORY_CLIENT,
	},
	selectedSiteId: siteId,
	wpworkspace: {
		appName: window.appGlobals?.appName ?? 'WordPress Studio',
		currentActivity: selectedSite.running
			? 'Working on a running Studio site'
			: 'Working in Studio',
		clientVersion: window.appGlobals?.appVersion,
		localWorkspace: {
			id: selectedSite.id,
			name: selectedSite.name,
			siteId,
			instructions:
				'This conversation is running inside WordPress Studio. The active local site can be inspected in Studio, but this integration has not exposed frontend tools yet.',
			projects: [
				{
					id: selectedSite.id,
					name: selectedSite.name,
					kind: 'studio-site',
					writePolicy: 'read_only',
					rootName: selectedSite.path.split( '/' ).filter( Boolean ).pop() ?? selectedSite.name,
				},
			],
		},
	},
} );

const sendDollyMessage = async ( {
	client,
	message,
	selectedSite,
	sessionId,
	siteId,
}: {
	client: WPCOM;
	message: string;
	selectedSite: SiteDetails;
	sessionId?: string;
	siteId: number;
} ): Promise< DollyAgentResponse > => {
	const taskId = crypto.randomUUID();
	const body = {
		jsonrpc: '2.0',
		id: crypto.randomUUID(),
		method: 'message/send',
		params: {
			id: taskId,
			sessionId,
			message: {
				role: 'user',
				parts: [
					{
						type: 'text',
						text: message,
					},
					{
						type: 'data',
						data: {
							clientContext: createDollyClientContext( siteId, selectedSite ),
						},
					},
				],
			},
		},
	};

	const response = await wpcomPost< unknown >(
		client,
		`/sites/${ siteId }/ai/agent/${ DOLLY_AGENT_ID }`,
		body
	);
	return parseDollyAgentResponse( response, taskId );
};

// Telex icon with red/orange background
const TelexIcon = () => (
	<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="rgb(229, 74, 39)" />
		<g transform="translate(5, 5)" clipPath="url(#clip0_telex_icon)">
			<path
				d="M13.7035 6.58213L10.8309 5.59124C9.69491 5.20089 8.79911 4.30509 8.40876 3.16908L7.41787 0.296515C7.28275 -0.0988382 6.71725 -0.0988382 6.58213 0.296515L5.59124 3.16908C5.20089 4.30509 4.30509 5.20089 3.16908 5.59124L0.296515 6.58213C-0.0988382 6.71725 -0.0988382 7.28275 0.296515 7.41787L3.16908 8.40876C4.30509 8.79911 5.20089 9.69491 5.59124 10.8309L6.58213 13.7035C6.71725 14.0988 7.28275 14.0988 7.41787 13.7035L8.40876 10.8309C8.79911 9.69491 9.69491 8.79911 10.8309 8.40876L13.7035 7.41787C14.0988 7.28275 14.0988 6.71725 13.7035 6.58213ZM10.3505 7.21269L8.91421 7.70813C8.3437 7.90331 7.8983 8.35371 7.70313 8.91921L7.20768 10.3555C7.13762 10.5557 6.85737 10.5557 6.79231 10.3555L6.29687 8.91921C6.1017 8.3487 5.6513 7.90331 5.08579 7.70813L3.64951 7.21269C3.44933 7.14263 3.44933 6.86238 3.64951 6.79232L5.08579 6.29687C5.6563 6.1017 6.1017 5.6513 6.29687 5.08579L6.79231 3.64951C6.86238 3.44933 7.14263 3.44933 7.20768 3.64951L7.70313 5.08579C7.8983 5.6563 8.3487 6.1017 8.91421 6.29687L10.3505 6.79232C10.5507 6.86238 10.5507 7.14263 10.3505 7.21269Z"
				fill="currentColor"
			/>
		</g>
		<defs>
			<clipPath id="clip0_telex_icon">
				<rect width="14" height="14" fill="white" />
			</clipPath>
		</defs>
	</svg>
);

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
		<div className="text-frame-text-secondary flex justify-end py-2 text-xs">
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
		<div className="text-center h-12 px-2 pt-6 text-frame-text-secondary">
			{ createInterpolateElement( resetMessage, {
				a: <Button onClick={ () => getIpcApi().showUserSettings( 'account' ) } variant="link" />,
			} ) }
		</div>
	);
};

const OfflineModeView = () => {
	const offlineMessage = __( 'The AI assistant requires an internet connection.' );

	return (
		<div className="flex items-center justify-center h-12 px-2 pt-4 text-frame-text-secondary gap-1">
			<Icon className="m-1 fill-frame-text-secondary" size={ 24 } icon={ offlineIcon } />
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
	return <DollyAssistant selectedSite={ selectedSite } />;
}

function DollyAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const inputRef = useRef< HTMLTextAreaElement >( null );
	const wrapperRef = useRef< HTMLDivElement >( null );
	const { isAuthenticated, authenticate, user, client } = useAuth();
	const isOffline = useOffline();
	const [ input, setInput ] = useState( '' );
	const [ dollySites, setDollySites ] = useState< DollySite[] >( [] );
	const [ selectedDollySiteId, setSelectedDollySiteId ] = useState< number | undefined >();
	const [ isLoadingSites, setIsLoadingSites ] = useState( false );
	const [ sitesError, setSitesError ] = useState< string | undefined >();
	const [ messages, setMessages ] = useState< MessageType[] >( [] );
	const [ sessionId, setSessionId ] = useState< string | undefined >();
	const [ isAssistantThinking, setIsAssistantThinking ] = useState( false );
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const instanceId = user?.id
		? `dolly_${ user.id }_${ selectedSite.id }_${ selectedDollySiteId ?? 'none' }`
		: `dolly_${ selectedSite.id }_${ selectedDollySiteId ?? 'none' }`;
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];

	useEffect( () => {
		if ( ! isAuthenticated || ! client || isOffline ) {
			return;
		}

		let isCurrent = true;
		setIsLoadingSites( true );
		setSitesError( undefined );

		wpcomGet< unknown >( client, '/ai/agent/dolly/sites' )
			.then( ( response ) => {
				if ( ! isCurrent ) {
					return;
				}
				setDollySites( parseDollySites( response ) );
			} )
			.catch( ( error ) => {
				if ( ! isCurrent ) {
					return;
				}
				console.error( error );
				setSitesError(
					error instanceof Error ? error.message : __( 'Failed to load Dolly sites.' )
				);
			} )
			.finally( () => {
				if ( isCurrent ) {
					setIsLoadingSites( false );
				}
			} );

		return () => {
			isCurrent = false;
		};
	}, [ client, isAuthenticated, isOffline ] );

	useEffect( () => {
		if ( dollySites.length === 0 ) {
			setSelectedDollySiteId( undefined );
			return;
		}

		setSelectedDollySiteId( ( currentSiteId ) => {
			if ( currentSiteId && dollySites.some( ( site ) => site.id === currentSiteId ) ) {
				return currentSiteId;
			}

			const connectedSite = connectedSites.find( ( connectedSite ) =>
				dollySites.some( ( site ) => site.id === connectedSite.id )
			);
			return connectedSite?.id ?? dollySites[ 0 ].id;
		} );
	}, [ connectedSites, dollySites ] );

	useEffect( () => {
		setMessages( [] );
		setSessionId( undefined );
		setInput( '' );
	}, [ selectedDollySiteId ] );

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			const trimmedMessage = chatMessage.trim();
			if ( ! trimmedMessage || ! client || ! selectedDollySiteId || isAssistantThinking ) {
				return;
			}

			if ( ! isRetry ) {
				setInput( '' );
			}

			const newMessageId = isRetry ? messages.length - 1 : messages.length;
			const message = generateMessage( trimmedMessage, 'user', newMessageId );

			setMessages( ( currentMessages ) => {
				if ( ! isRetry ) {
					return [ ...currentMessages, message ];
				}

				return currentMessages.map( ( currentMessage ) =>
					currentMessage.id === message.id
						? { ...currentMessage, failedMessage: false }
						: currentMessage
				);
			} );
			setIsAssistantThinking( true );

			void sendDollyMessage( {
				client,
				message: trimmedMessage,
				selectedSite,
				sessionId,
				siteId: selectedDollySiteId,
			} )
				.then( ( response ) => {
					if ( response.sessionId ) {
						setSessionId( response.sessionId );
					}

					setMessages( ( currentMessages ) => [
						...currentMessages,
						generateMessage( response.text, 'assistant', currentMessages.length ),
					] );
				} )
				.catch( ( error ) => {
					console.error( error );
					setMessages( ( currentMessages ) =>
						currentMessages.map( ( currentMessage ) =>
							currentMessage.id === message.id
								? { ...currentMessage, failedMessage: true }
								: currentMessage
						)
					);
				} )
				.finally( () => {
					setIsAssistantThinking( false );
				} );
		},
		[ client, isAssistantThinking, messages.length, selectedDollySiteId, selectedSite, sessionId ]
	);

	const clearConversation = useCallback( () => {
		setInput( '' );
		setMessages( [] );
		setSessionId( undefined );
	}, [] );

	const renderNotice = () => {
		if ( isOffline ) {
			return <OfflineModeView />;
		}
		if ( isAuthenticated && messages.length > 0 ) {
			return (
				<ClearHistoryReminder lastMessage={ lastMessage } clearConversation={ clearConversation } />
			);
		}
	};

	const renderEmptyState = () => {
		if ( ! isAuthenticated || messages.length > 0 ) {
			return null;
		}

		let content: string = String( __( 'Loading Dolly…' ) );
		if ( sitesError ) {
			content = sitesError;
		} else if ( ! isLoadingSites && dollySites.length === 0 ) {
			content = String( __( 'Dolly did not return any WordPress.com sites for this account.' ) );
		} else if ( selectedDollySiteId ) {
			content = String( __( 'Ask Dolly about this WordPress.com site.' ) );
		}

		return (
			<ChatMessage
				id="message-dolly-welcome"
				message={ generateMessage( content, 'assistant', 0 ) }
				instanceId={ instanceId }
			>
				{ content }
			</ChatMessage>
		);
	};

	const disabled =
		isOffline ||
		! isAuthenticated ||
		! selectedDollySiteId ||
		isLoadingSites ||
		isAssistantThinking ||
		hasFailedMessage;

	return (
		<div className="relative min-h-full flex flex-col" ref={ wrapperRef }>
			{ isAuthenticated && dollySites.length > 0 && (
				<div className="px-8 pt-4">
					<SelectControl
						label={ __( 'Dolly site' ) }
						value={ String( selectedDollySiteId ?? '' ) }
						options={ dollySites.map( ( site ) => ( {
							label: site.url ? `${ site.name } (${ site.url })` : site.name,
							value: String( site.id ),
						} ) ) }
						onChange={ ( value ) => setSelectedDollySiteId( Number( value ) ) }
						__nextHasNoMarginBottom
						__next40pxDefaultSize
					/>
				</div>
			) }
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
							{ renderEmptyState() }
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

			<div className="sticky bottom-0 bg-frame/80 backdrop-blur-sm w-full px-8 pt-4 flex items-center">
				<div className="w-full flex flex-col items-center">
					<AIInput
						ref={ inputRef }
						disabled={ disabled }
						input={ input }
						setInput={ setInput }
						handleSend={ () => {
							submitPrompt( inputRef.current?.value ?? '' );
						} }
						handleKeyDown={ () => undefined }
						clearConversation={ clearConversation }
						isAssistantThinking={ isAssistantThinking }
						showTelexLink={ false }
					/>
					<div data-testid="guidelines-link" className="text-frame-text-secondary self-end py-2">
						{ __( 'Powered by Dolly.' ) }
					</div>
				</div>
			</div>
		</div>
	);
}

export function WpcomAssistant( { selectedSite }: ContentTabAssistantProps ) {
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

	const [ isTelexBannerVisible, setIsTelexBannerVisible ] = useState(
		() => localStorage.getItem( 'dontShowTelexBanner' ) !== 'true'
	);

	const handleDismissBanner = () => {
		localStorage.setItem( 'dontShowTelexBanner', 'true' );
		setIsTelexBannerVisible( false );
	};

	return (
		<div className="relative min-h-full flex flex-col" ref={ wrapperRef }>
			{ isTelexBannerVisible && (
				<div className="bg-frame border border-frame-border rounded-sm m-8 mb-0 p-2 pr-4 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<TelexIcon />
						<span className="text-frame-text">
							{ createInterpolateElement(
								__( 'Build blocks with <button>Telex <ArrowIcon/></button>' ),
								{
									button: (
										<Button
											variant="link"
											onClick={ () => {
												const telexUrl = addUrlParams(
													`https://${ TELEX_HOSTNAME }/`,
													TELEX_UTM_PARAMS
												);
												getIpcApi().openURL( telexUrl );
											} }
										/>
									),
									ArrowIcon: <ArrowIcon />,
								}
							) }
						</span>
					</div>
					<button
						onClick={ handleDismissBanner }
						className="text-frame-text-secondary hover:text-frame-text"
						aria-label={ __( 'Dismiss' ) }
					>
						✕
					</button>
				</div>
			) }
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
								key={ selectedSite.id }
								onExampleClick={ ( prompt ) => {
									submitPrompt( prompt );
									inputRef.current?.focus();
								} }
								showExamplePrompts={ messages.length === 0 }
								messages={ data?.messages ?? [] }
								examplePrompts={ data?.example_prompts ?? [] }
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

			<div className="sticky bottom-0 bg-frame/80 backdrop-blur-sm w-full px-8 pt-4 flex items-center">
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
					<div data-testid="guidelines-link" className="text-frame-text-secondary self-end py-2">
						{ createInterpolateElement( __( 'Powered by experimental AI. <learn_more_link />' ), {
							learn_more_link: (
								<LearnMoreLink docsLinksKey="a8cAiGuidelines" className="!text-frame-theme" />
							),
						} ) }
					</div>
				</div>
			</div>
		</div>
	);
}
