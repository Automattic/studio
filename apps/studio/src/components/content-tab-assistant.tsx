import {
	SelectControl,
	__unstableAnimatePresence as AnimatePresence,
	__unstableMotion as motion,
} from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { closeSmall, desktop, external, Icon, redo } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, memo, useCallback, useMemo, forwardRef } from 'react';
import { createPortal } from 'react-dom';
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
import { getSiteUrl } from 'src/lib/get-site-url';
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
import type { SyncSite } from '@studio/common/types/sync';
import type { WPCOM } from 'wpcom/types';

export const MIMIC_CONVERSATION_DELAY = 500;
const DOLLY_AGENT_ID = 'dolly';
const DOLLY_HISTORY_CLIENT = 'wpworkspace';
const DOLLY_PREVIEW_TOOL_ID = 'wpworkspace/preview';
const DOLLY_PREVIEW_PANEL_DEFAULT_WIDTH = 520;
const DOLLY_PREVIEW_PANEL_MIN_WIDTH = 360;
const DOLLY_PREVIEW_PANEL_MAX_WIDTH = 820;
const MAX_FRONTEND_TOOL_ROUNDS = 3;

type DollySite = {
	id: number;
	name: string;
	url?: string;
	slug?: string;
};

type ConnectedDollySite = DollySite & {
	connectedSite: SyncSite;
};

type DollyAgentResponse = {
	text: string;
	sessionId?: string;
	taskId: string;
	state: string;
	toolCalls: DollyToolCall[];
};

type AgentResponsePart = {
	type?: string;
	text?: string;
	data?: {
		toolCallId?: string;
		tool_call_id?: string;
		toolId?: string;
		tool_id?: string;
		arguments?: unknown;
	};
};

type AgentRequestPart = {
	type: 'text' | 'data';
	text?: string;
	data?: Record< string, unknown >;
	metadata?: Record< string, unknown >;
};

type DollyToolCall = {
	toolCallId: string;
	toolId: string;
	arguments: Record< string, unknown >;
};

type DollyToolExecution = {
	toolResult: {
		toolCallId: string;
		toolId: string;
		result?: Record< string, unknown >;
		error?: string;
	};
	agentMessage?: string;
};

type DollyPreviewState = {
	open: boolean;
	pathOrUrl: string;
	title?: string;
	currentUrl?: string;
	pageTitle?: string;
	isLoading: boolean;
	reloadNonce: number;
};

type DollyPreviewContext = {
	isOpen: boolean;
	siteId: string;
	openedURL?: string;
	currentURL?: string;
	title?: string;
	isLoading: boolean;
};

type DollySiteAssociationContext = {
	status: 'connected' | 'local_only' | 'unassociated' | 'unavailable' | 'wpcom_only';
	localSiteId: string;
	localSiteName: string;
	localSitePath: string;
	localPreviewUrl: string;
	routingWpcomSiteId?: number;
	routingWpcomSiteUrl?: string;
	connectedWpcomSiteId?: number;
	connectedWpcomSiteUrl?: string;
	instructions: string;
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

const normalizeToolId = ( value: string ) => value.trim().toLowerCase();

const isPreviewToolId = ( value: string ) =>
	[ DOLLY_PREVIEW_TOOL_ID, 'wpstudio/preview', 'preview' ].includes( normalizeToolId( value ) );

const parseToolArguments = ( value: unknown ): Record< string, unknown > => {
	if ( isRecord( value ) ) {
		return value;
	}

	if ( typeof value !== 'string' ) {
		return {};
	}

	try {
		const parsed = JSON.parse( value );
		return isRecord( parsed ) ? parsed : {};
	} catch {
		return {};
	}
};

const getStringValue = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): string | undefined => {
	for ( const key of possibleKeys ) {
		const value = record[ key ];
		if ( typeof value === 'string' && value.trim() ) {
			return value.trim();
		}
	}
};

const createDollyPreviewAbility = () => ( {
	name: DOLLY_PREVIEW_TOOL_ID,
	label: 'Preview URL',
	description:
		'Open a web URL in the WordPress Studio side preview panel. Replaces any preview that is already open.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'The absolute http or https URL to preview. Studio also accepts local site paths such as / or /wp-admin/.',
			},
			title: {
				type: 'string',
				description: 'Optional short title to show in the preview header.',
			},
		},
		required: [ 'url' ],
	},
	output_schema: {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			url: { type: 'string' },
			message: { type: 'string' },
		},
	},
	meta: {
		annotations: {
			instructions:
				'Use when the user asks to open, show, inspect, preview, or keep a URL visible beside the chat.',
			readonly: false,
			destructive: false,
			idempotent: true,
		},
	},
} );

const createDollyClientContext = (
	siteId: number,
	selectedSite: SiteDetails,
	previewContext?: DollyPreviewContext,
	siteAssociation?: DollySiteAssociationContext
) => ( {
	constructorArguments: {
		client: DOLLY_HISTORY_CLIENT,
	},
	selectedSiteId: siteId,
	preview: previewContext,
	studioSiteAssociation: siteAssociation,
	frontendAbilities: [ DOLLY_PREVIEW_TOOL_ID ],
	wpworkspace: {
		appName: window.appGlobals?.appName ?? 'WordPress Studio',
		currentActivity:
			siteAssociation?.status === 'wpcom_only'
				? 'Working on a WordPress.com site selected from Studio'
				: siteAssociation?.status === 'local_only'
				? 'Discussing a local-only Studio site that is not hosted on WordPress.com'
				: siteAssociation?.status === 'unassociated'
				? 'Discussing a Studio site that is not associated with the selected WordPress.com routing site'
				: selectedSite.running
				? 'Working on a running Studio site with an embedded preview available'
				: 'Working in Studio',
		clientVersion: window.appGlobals?.appVersion,
		preview: previewContext,
		studioSiteAssociation: siteAssociation,
		frontendAbilities: [ DOLLY_PREVIEW_TOOL_ID ],
		localWorkspace: {
			id: selectedSite.id,
			name: selectedSite.name,
			siteId,
			instructions:
				siteAssociation?.instructions ??
				'This conversation is running inside WordPress Studio. Use the wpworkspace/preview frontend ability when the user asks to show, inspect, or keep a URL visible beside the chat.',
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

const extractToolCalls = ( parts: AgentResponsePart[] ): DollyToolCall[] =>
	parts
		.map< DollyToolCall | undefined >( ( part ) => {
			if ( part.type !== 'data' || ! isRecord( part.data ) ) {
				return undefined;
			}

			const toolCallId =
				typeof part.data.toolCallId === 'string'
					? part.data.toolCallId
					: typeof part.data.tool_call_id === 'string'
					? part.data.tool_call_id
					: undefined;
			const toolId =
				typeof part.data.toolId === 'string'
					? part.data.toolId
					: typeof part.data.tool_id === 'string'
					? part.data.tool_id
					: undefined;

			if ( ! toolCallId || ! toolId ) {
				return undefined;
			}

			return {
				toolCallId,
				toolId,
				arguments: parseToolArguments( part.data.arguments ),
			};
		} )
		.filter( ( toolCall ): toolCall is DollyToolCall => Boolean( toolCall ) );

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
	const toolCalls = extractToolCalls( parts );

	const fallbackText = toolCalls.length > 0 ? '' : __( 'Dolly did not return a text response.' );

	return {
		text: text || fallbackText,
		sessionId:
			typeof response.result.sessionId === 'string' ? response.result.sessionId : undefined,
		taskId: typeof response.result.id === 'string' ? response.result.id : fallbackTaskId,
		state:
			typeof response.result.status.state === 'string' ? response.result.status.state : 'unknown',
		toolCalls,
	};
};

const createDollyMessageBody = ( {
	taskId,
	sessionId,
	parts,
}: {
	taskId: string;
	sessionId?: string;
	parts: AgentRequestPart[];
} ) => ( {
	jsonrpc: '2.0',
	id: crypto.randomUUID(),
	method: 'message/send',
	params: {
		id: taskId,
		sessionId,
		message: {
			role: 'user',
			parts,
		},
	},
} );

const createDollyClientContextPart = (
	siteId: number,
	selectedSite: SiteDetails,
	previewContext?: DollyPreviewContext,
	siteAssociation?: DollySiteAssociationContext
): AgentRequestPart => ( {
	type: 'data',
	data: {
		clientContext: createDollyClientContext(
			siteId,
			selectedSite,
			previewContext,
			siteAssociation
		),
	},
} );

const createDollyToolResultParts = (
	toolCalls: DollyToolCall[],
	executions: DollyToolExecution[]
): AgentRequestPart[] => [
	...toolCalls.map< AgentRequestPart >( ( toolCall ) => ( {
		type: 'data',
		data: {
			toolCallId: toolCall.toolCallId,
			toolId: toolCall.toolId,
			arguments: toolCall.arguments,
		},
	} ) ),
	...executions.map< AgentRequestPart >( ( execution ) => ( {
		type: 'data',
		data: {
			toolCallId: execution.toolResult.toolCallId,
			toolId: execution.toolResult.toolId,
			result: execution.toolResult.result,
		},
		...( execution.toolResult.error ? { metadata: { error: execution.toolResult.error } } : {} ),
	} ) ),
];

const combineDollyText = ( first: string, second: string ) =>
	[ first.trim(), second.trim() ].filter( Boolean ).join( '\n\n' );

const sendDollyMessage = async ( {
	client,
	executeFrontendTool,
	message,
	previewContext,
	siteAssociation,
	selectedSite,
	sessionId,
	siteId,
}: {
	client: WPCOM;
	executeFrontendTool: ( toolCall: DollyToolCall ) => Promise< DollyToolExecution >;
	message: string;
	previewContext?: DollyPreviewContext;
	siteAssociation?: DollySiteAssociationContext;
	selectedSite: SiteDetails;
	sessionId?: string;
	siteId: number;
} ): Promise< DollyAgentResponse > => {
	const taskId = crypto.randomUUID();
	const createClientContextPart = () =>
		createDollyClientContextPart( siteId, selectedSite, previewContext, siteAssociation );
	const initialParts: AgentRequestPart[] = [
		{
			type: 'text',
			text: message,
		},
		{
			type: 'data',
			data: createDollyPreviewAbility(),
		},
		createClientContextPart(),
	];

	let response = parseDollyAgentResponse(
		await wpcomPost< unknown >(
			client,
			`/sites/${ siteId }/ai/agent/${ DOLLY_AGENT_ID }`,
			createDollyMessageBody( { taskId, sessionId, parts: initialParts } )
		),
		taskId
	);
	let currentSessionId = response.sessionId ?? sessionId;
	let accumulatedText = response.text;

	for ( let round = 0; round < MAX_FRONTEND_TOOL_ROUNDS; round++ ) {
		if ( response.toolCalls.length === 0 ) {
			return {
				...response,
				text: accumulatedText,
				sessionId: currentSessionId,
			};
		}

		const executions = await Promise.all( response.toolCalls.map( executeFrontendTool ) );
		const fallbackToolMessage = executions
			.map( ( execution ) => execution.agentMessage )
			.filter( ( value ): value is string => Boolean( value ) )
			.join( '\n' );
		const continuationParts = [
			...createDollyToolResultParts( response.toolCalls, executions ),
			createClientContextPart(),
		];

		try {
			response = parseDollyAgentResponse(
				await wpcomPost< unknown >(
					client,
					`/sites/${ siteId }/ai/agent/${ DOLLY_AGENT_ID }`,
					createDollyMessageBody( {
						taskId: response.taskId,
						sessionId: currentSessionId,
						parts: continuationParts,
					} )
				),
				response.taskId
			);
			currentSessionId = response.sessionId ?? currentSessionId;
			accumulatedText = combineDollyText( accumulatedText, response.text );
		} catch ( error ) {
			if ( fallbackToolMessage ) {
				return {
					...response,
					text: combineDollyText( accumulatedText, fallbackToolMessage ),
					sessionId: currentSessionId,
					toolCalls: [],
				};
			}
			throw error;
		}
	}

	return {
		...response,
		text: accumulatedText || __( 'Dolly asked Studio to run too many frontend preview actions.' ),
		sessionId: currentSessionId,
		toolCalls: [],
	};
};

const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) {
		return false;
	}
	return /\bElectron\//.test( navigator.userAgent );
};

const isHttpUrl = ( value: string ) => {
	try {
		const url = new URL( value );
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
};

const normalizePreviewUrl = (
	baseUrl: string,
	rawValue: string,
	{ autoLoginSameOrigin = false }: { autoLoginSameOrigin?: boolean } = {}
) => {
	const trimmedValue = rawValue.trim();
	let targetUrl: URL;

	if ( isHttpUrl( trimmedValue ) ) {
		targetUrl = new URL( trimmedValue );
	} else if ( trimmedValue.includes( '.' ) && ! trimmedValue.startsWith( '/' ) ) {
		targetUrl = new URL( `https://${ trimmedValue }` );
	} else {
		targetUrl = new URL( trimmedValue || '/', baseUrl );
	}

	const siteOrigin = new URL( baseUrl ).origin;
	if ( targetUrl.origin !== siteOrigin || ! autoLoginSameOrigin ) {
		return targetUrl.toString();
	}
	if ( targetUrl.pathname === '/studio-auto-login' ) {
		return targetUrl.toString();
	}

	const autoLoginUrl = new URL( '/studio-auto-login', baseUrl );
	autoLoginUrl.searchParams.set( 'redirect_to', targetUrl.toString() );
	return autoLoginUrl.toString();
};

const createPreviewContext = (
	selectedSite: SiteDetails,
	previewState: DollyPreviewState,
	previewUrl?: string
): DollyPreviewContext => ( {
	isOpen: previewState.open,
	siteId: selectedSite.id,
	openedURL: previewUrl,
	currentURL: previewState.currentUrl ?? previewUrl,
	title: previewState.pageTitle ?? previewState.title,
	isLoading: previewState.isLoading,
} );

const createSiteAssociationContext = ( {
	activeDollySiteId,
	activeDollySiteUrl,
	connectedDollySite,
	hasConnectedSites,
	selectedSite,
}: {
	activeDollySiteId?: number;
	activeDollySiteUrl?: string;
	connectedDollySite?: ConnectedDollySite;
	hasConnectedSites: boolean;
	selectedSite: SiteDetails;
} ): DollySiteAssociationContext => {
	if ( connectedDollySite ) {
		return {
			status: 'connected',
			localSiteId: selectedSite.id,
			localSiteName: selectedSite.name,
			localSitePath: selectedSite.path,
			localPreviewUrl: getSiteUrl( selectedSite ),
			routingWpcomSiteId: connectedDollySite.id,
			routingWpcomSiteUrl: connectedDollySite.connectedSite.url,
			connectedWpcomSiteId: connectedDollySite.connectedSite.id,
			connectedWpcomSiteUrl: connectedDollySite.connectedSite.url,
			instructions:
				'The active Studio site is connected to this WordPress.com site. Dolly may manage the WordPress.com site and may use frontend abilities for preview actions.',
		};
	}

	if ( activeDollySiteId ) {
		const status = hasConnectedSites ? 'unassociated' : 'local_only';
		return {
			status,
			localSiteId: selectedSite.id,
			localSiteName: selectedSite.name,
			localSitePath: selectedSite.path,
			localPreviewUrl: getSiteUrl( selectedSite ),
			routingWpcomSiteId: activeDollySiteId,
			routingWpcomSiteUrl: activeDollySiteUrl,
			instructions:
				status === 'local_only'
					? 'The active Studio site is local-only and is not associated with a WordPress.com site. The WordPress.com site id on this request is only a Dolly routing context, not the local site being discussed. Dolly cannot manage this local site through WordPress.com until it is deployed or connected to WordPress.com. If the user asks Dolly to manage or publish changes for this site, explain that it needs to be hosted on WordPress.com first.'
					: 'The selected WordPress.com site is not associated with the active local Studio site. The selected WordPress.com site id is only a Dolly routing context for this request, not the local site being discussed. Do not claim Dolly can manage this local site through that WordPress.com site. If the user wants Dolly to manage the local site, tell them to switch to the connected WordPress.com site or connect/deploy this site on WordPress.com.',
		};
	}

	if ( hasConnectedSites ) {
		return {
			status: 'unassociated',
			localSiteId: selectedSite.id,
			localSiteName: selectedSite.name,
			localSitePath: selectedSite.path,
			localPreviewUrl: getSiteUrl( selectedSite ),
			instructions:
				'The active Studio site has a WordPress.com relationship, but no selected WordPress.com routing site is available in this request. Do not claim Dolly can manage it until the user chooses the associated WordPress.com site.',
		};
	}

	return {
		status: 'unavailable',
		localSiteId: selectedSite.id,
		localSiteName: selectedSite.name,
		localSitePath: selectedSite.path,
		localPreviewUrl: getSiteUrl( selectedSite ),
		routingWpcomSiteId: activeDollySiteId,
		instructions:
			'The active Studio site is not available to Dolly. Do not claim Dolly can manage it.',
	};
};

const createWpcomOnlySiteDetails = ( selectedWpcomSite: SyncSite ): SiteDetails => ( {
	id: `wpcom-${ selectedWpcomSite.id }`,
	name: selectedWpcomSite.name,
	path: '',
	port: 0,
	phpVersion: '',
	running: true,
	url: selectedWpcomSite.url,
} );

const createWpcomOnlySiteAssociationContext = (
	selectedWpcomSite: SyncSite
): DollySiteAssociationContext => ( {
	status: 'wpcom_only',
	localSiteId: '',
	localSiteName: '',
	localSitePath: '',
	localPreviewUrl: selectedWpcomSite.url,
	routingWpcomSiteId: selectedWpcomSite.id,
	routingWpcomSiteUrl: selectedWpcomSite.url,
	connectedWpcomSiteId: selectedWpcomSite.id,
	connectedWpcomSiteUrl: selectedWpcomSite.url,
	instructions:
		'This is a WordPress.com site selected from Studio that is not connected to a local Studio site. Dolly may manage this WordPress.com site. Studio local site controls, sync tabs, and local filesystem actions do not apply to this selection.',
} );

const initialPreviewState = (): DollyPreviewState => ( {
	open: false,
	pathOrUrl: '/',
	isLoading: false,
	reloadNonce: 0,
} );

interface PreviewWebviewTag extends HTMLElement {
	loadURL( url: string ): Promise< void >;
	reload(): void;
	getURL(): string;
	getTitle(): string;
}

interface PreviewWebviewTitleEvent extends Event {
	title?: string;
}

interface DollyPreviewPanelProps {
	selectedSite: SiteDetails;
	previewMode: 'live' | 'local';
	previewState: DollyPreviewState;
	previewUrl?: string;
	onClose: () => void;
	onRefresh: () => void;
	onStartSite?: () => void | Promise< void >;
	onUpdateState: ( state: Partial< DollyPreviewState > ) => void;
}

const DollyPreviewPanelPortal = ( { children }: { children: React.ReactNode } ) => {
	const [ portalRoot, setPortalRoot ] = useState< HTMLElement | null >( () =>
		typeof document === 'undefined'
			? null
			: document.getElementById( 'assistant-preview-panel-root' )
	);

	useEffect( () => {
		if ( typeof document === 'undefined' ) {
			return;
		}
		setPortalRoot( document.getElementById( 'assistant-preview-panel-root' ) );
	}, [] );

	if ( ! portalRoot ) {
		return <>{ children }</>;
	}

	return createPortal( children, portalRoot );
};

function DollyPreviewPanel( {
	selectedSite,
	previewMode,
	previewState,
	previewUrl,
	onClose,
	onRefresh,
	onStartSite,
	onUpdateState,
}: DollyPreviewPanelProps ) {
	const [ width, setWidth ] = useState( DOLLY_PREVIEW_PANEL_DEFAULT_WIDTH );
	const [ isStartingSite, setIsStartingSite ] = useState( false );
	const title = previewState.pageTitle || previewState.title || __( 'Site preview' );
	const displayUrl = previewState.currentUrl || previewUrl || getSiteUrl( selectedSite );
	const canStartLocalSite = previewMode === 'local' && ! selectedSite.running && onStartSite;

	const startSite = () => {
		if ( ! onStartSite ) {
			return;
		}
		setIsStartingSite( true );
		void Promise.resolve( onStartSite() ).finally( () => setIsStartingSite( false ) );
	};

	const handleResizeStart = ( event: React.PointerEvent< HTMLButtonElement > ) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = width;
		const maxWidth = Math.min( DOLLY_PREVIEW_PANEL_MAX_WIDTH, window.innerWidth * 0.65 );

		const handlePointerMove = ( pointerEvent: PointerEvent ) => {
			const nextWidth = startWidth + startX - pointerEvent.clientX;
			setWidth( Math.max( DOLLY_PREVIEW_PANEL_MIN_WIDTH, Math.min( maxWidth, nextWidth ) ) );
		};

		const handlePointerUp = () => {
			window.removeEventListener( 'pointermove', handlePointerMove );
			window.removeEventListener( 'pointerup', handlePointerUp );
		};

		window.addEventListener( 'pointermove', handlePointerMove );
		window.addEventListener( 'pointerup', handlePointerUp );
	};

	return (
		<aside
			className="relative h-full shrink-0 border-l border-a8c-gray-5 bg-white flex flex-col"
			style={ { width } }
			aria-label={ __( 'Assistant site preview' ) }
		>
			<button
				type="button"
				className="absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-col-resize border-0 bg-transparent p-0"
				aria-label={ __( 'Resize site preview' ) }
				aria-orientation="vertical"
				role="separator"
				onPointerDown={ handleResizeStart }
			/>
			<div className="h-12 shrink-0 border-b border-a8c-gray-5 px-3 flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] leading-4 font-medium text-frame-text">
						{ title }
					</div>
					<div className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</div>
				</div>
				<Button
					variant="icon"
					tooltipText={ __( 'Reload preview' ) }
					disabled={ ! previewUrl }
					onClick={ onRefresh }
					aria-label={ __( 'Reload preview' ) }
				>
					<Icon icon={ redo } size={ 18 } />
				</Button>
				<Button
					variant="icon"
					tooltipText={ __( 'Open in browser' ) }
					disabled={ ! previewUrl }
					onClick={ () => getIpcApi().openURL( previewState.currentUrl || previewUrl || '' ) }
					aria-label={ __( 'Open in browser' ) }
				>
					<Icon icon={ external } size={ 18 } />
				</Button>
				<Button
					variant="icon"
					tooltipText={ __( 'Close preview' ) }
					onClick={ onClose }
					aria-label={ __( 'Close preview' ) }
				>
					<Icon icon={ closeSmall } size={ 20 } />
				</Button>
			</div>
			<div className="relative min-h-0 flex-1 bg-a8c-gray-0">
				{ previewUrl ? (
					isElectron() ? (
						<DollyPreviewWebview
							key={ selectedSite.id }
							url={ previewUrl }
							reloadNonce={ previewState.reloadNonce }
							onUpdateState={ onUpdateState }
						/>
					) : (
						<iframe
							key={ `${ previewUrl }#${ previewState.reloadNonce }` }
							className="absolute inset-0 h-full w-full border-0 bg-white"
							src={ previewUrl }
							title={ `${ selectedSite.name } preview` }
							onLoad={ () =>
								onUpdateState( {
									currentUrl: previewUrl,
									isLoading: false,
								} )
							}
						/>
					)
				) : (
					<div className="h-full p-6 flex flex-col items-center justify-center gap-3 text-center">
						<Icon icon={ desktop } size={ 32 } className="fill-frame-text-secondary" />
						<div>
							<div className="text-sm font-medium text-frame-text">
								{ previewMode === 'local'
									? __( 'Start the site to see a local preview.' )
									: __( 'Choose a connected WordPress.com site to see a live preview.' ) }
							</div>
							<div className="mt-1 text-xs text-frame-text-secondary">
								{ previewMode === 'local'
									? __(
											'Dolly can discuss this local site, but management requires WordPress.com.'
									  )
									: __( 'Dolly previews the live WordPress.com site that it can manage.' ) }
							</div>
						</div>
						{ canStartLocalSite && (
							<Button variant="primary" onClick={ startSite } isBusy={ isStartingSite }>
								{ __( 'Start site' ) }
							</Button>
						) }
					</div>
				) }
				{ previewState.isLoading && previewUrl ? (
					<div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-a8c-gray-5">
						<div className="h-full w-1/2 animate-pulse bg-frame-theme" />
					</div>
				) : null }
			</div>
		</aside>
	);
}

function DollyPreviewWebview( {
	url,
	reloadNonce,
	onUpdateState,
}: {
	url: string;
	reloadNonce: number;
	onUpdateState: ( state: Partial< DollyPreviewState > ) => void;
} ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	const [ initialNav ] = useState( () => ( { url, reloadNonce } ) );

	useEffect( () => {
		const webview = ref.current as PreviewWebviewTag | null;
		if ( ! webview ) {
			return;
		}

		const updateFromWebview = ( nextState: Partial< DollyPreviewState > = {} ) => {
			onUpdateState( {
				currentUrl: webview.getURL?.() || url,
				pageTitle: webview.getTitle?.() || undefined,
				...nextState,
			} );
		};

		const handleDomReady = () => {
			setReady( true );
			updateFromWebview();
		};
		const handleStartLoading = () => onUpdateState( { isLoading: true } );
		const handleStopLoading = () => updateFromWebview( { isLoading: false } );
		const handleTitleUpdated = ( event: Event ) => {
			const titleEvent = event as PreviewWebviewTitleEvent;
			onUpdateState( { pageTitle: titleEvent.title } );
		};

		webview.addEventListener( 'dom-ready', handleDomReady );
		webview.addEventListener( 'did-start-loading', handleStartLoading );
		webview.addEventListener( 'did-stop-loading', handleStopLoading );
		webview.addEventListener( 'did-navigate', handleStopLoading );
		webview.addEventListener( 'did-navigate-in-page', handleStopLoading );
		webview.addEventListener( 'page-title-updated', handleTitleUpdated );
		return () => {
			webview.removeEventListener( 'dom-ready', handleDomReady );
			webview.removeEventListener( 'did-start-loading', handleStartLoading );
			webview.removeEventListener( 'did-stop-loading', handleStopLoading );
			webview.removeEventListener( 'did-navigate', handleStopLoading );
			webview.removeEventListener( 'did-navigate-in-page', handleStopLoading );
			webview.removeEventListener( 'page-title-updated', handleTitleUpdated );
		};
	}, [ onUpdateState, url ] );

	useEffect( () => {
		if ( ! ready ) {
			return;
		}
		const webview = ref.current as PreviewWebviewTag | null;
		if ( ! webview ) {
			return;
		}
		if ( url === initialNav.url && reloadNonce === initialNav.reloadNonce ) {
			return;
		}
		onUpdateState( { isLoading: true } );
		webview.loadURL( url ).catch( () => onUpdateState( { isLoading: false } ) );
	}, [ initialNav.reloadNonce, initialNav.url, onUpdateState, ready, reloadNonce, url ] );

	return (
		<webview
			ref={ ref }
			src={ initialNav.url }
			className="absolute inset-0 h-full w-full border-0 bg-white"
			allowpopups="true"
			partition="persist:site-preview"
		/>
	);
}

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

interface WpcomSiteAssistantProps {
	selectedWpcomSite: SyncSite;
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
	const [ previewState, setPreviewState ] = useState< DollyPreviewState >( initialPreviewState );
	const { data: connectedSites = [], isLoading: isLoadingConnectedSites } =
		useGetConnectedSitesForLocalSiteQuery( {
			localSiteId: selectedSite.id,
			userId: user?.id,
		} );
	const connectedDollySites = useMemo< ConnectedDollySite[] >(
		() =>
			connectedSites
				.map( ( connectedSite ) => {
					const dollySite = dollySites.find( ( site ) => site.id === connectedSite.id );
					return dollySite ? { ...dollySite, connectedSite } : undefined;
				} )
				.filter( ( site ): site is ConnectedDollySite => Boolean( site ) ),
		[ connectedSites, dollySites ]
	);
	const selectedConnectedDollySite = useMemo(
		() => connectedDollySites.find( ( site ) => site.id === selectedDollySiteId ),
		[ connectedDollySites, selectedDollySiteId ]
	);
	const hasConnectedSites = connectedSites.length > 0;
	const isLocalOnlySite = ! isLoadingConnectedSites && ! hasConnectedSites;
	const activeDollySite =
		selectedConnectedDollySite ??
		( isLocalOnlySite
			? dollySites.find( ( site ) => site.id === selectedDollySiteId ) ?? dollySites[ 0 ]
			: undefined );
	const activeDollySiteId = activeDollySite?.id;
	const activeDollySiteUrl = activeDollySite?.url;
	const selectedDollySiteUrl =
		selectedConnectedDollySite?.connectedSite.url || selectedConnectedDollySite?.url;
	const previewMode: 'live' | 'local' = selectedDollySiteUrl ? 'live' : 'local';
	const instanceId = user?.id
		? `dolly_${ user.id }_${ selectedSite.id }_${ activeDollySiteId ?? 'none' }`
		: `dolly_${ selectedSite.id }_${ activeDollySiteId ?? 'none' }`;
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];
	const previewUrl = useMemo( () => {
		if ( selectedDollySiteUrl ) {
			return normalizePreviewUrl( selectedDollySiteUrl, previewState.pathOrUrl );
		}
		if ( isLocalOnlySite && activeDollySiteId && selectedSite.running ) {
			return normalizePreviewUrl( getSiteUrl( selectedSite ), previewState.pathOrUrl, {
				autoLoginSameOrigin: true,
			} );
		}
		return undefined;
	}, [
		activeDollySiteId,
		isLocalOnlySite,
		previewState.pathOrUrl,
		selectedDollySiteUrl,
		selectedSite,
	] );
	const siteAssociation = useMemo(
		() =>
			createSiteAssociationContext( {
				activeDollySiteId,
				activeDollySiteUrl,
				connectedDollySite: selectedConnectedDollySite,
				hasConnectedSites,
				selectedSite,
			} ),
		[
			activeDollySiteId,
			activeDollySiteUrl,
			hasConnectedSites,
			selectedConnectedDollySite,
			selectedSite,
		]
	);
	const previewContext = useMemo(
		() => createPreviewContext( selectedSite, previewState, previewUrl ),
		[ previewState, previewUrl, selectedSite ]
	);

	const updatePreviewState = useCallback( ( nextState: Partial< DollyPreviewState > ) => {
		setPreviewState( ( currentState ) => ( { ...currentState, ...nextState } ) );
	}, [] );

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
		if ( connectedDollySites.length === 0 ) {
			if ( isLocalOnlySite && dollySites.length > 0 ) {
				setSelectedDollySiteId( ( currentSiteId ) => {
					if ( currentSiteId && dollySites.some( ( site ) => site.id === currentSiteId ) ) {
						return currentSiteId;
					}
					return dollySites[ 0 ].id;
				} );
				return;
			}
			setSelectedDollySiteId( undefined );
			return;
		}

		setSelectedDollySiteId( ( currentSiteId ) => {
			if ( currentSiteId && connectedDollySites.some( ( site ) => site.id === currentSiteId ) ) {
				return currentSiteId;
			}

			return connectedDollySites[ 0 ].id;
		} );
	}, [ connectedDollySites, dollySites, isLocalOnlySite ] );

	useEffect( () => {
		setMessages( [] );
		setSessionId( undefined );
		setInput( '' );
		setPreviewState( initialPreviewState() );
	}, [ selectedDollySiteId ] );

	useEffect( () => {
		setPreviewState( initialPreviewState() );
	}, [ selectedSite.id ] );

	const openPreview = useCallback(
		( pathOrUrl = '/', title?: string ) => {
			setPreviewState( ( currentState ) => ( {
				...currentState,
				open: true,
				pathOrUrl,
				title,
				pageTitle: undefined,
				currentUrl: undefined,
				isLoading: Boolean(
					selectedDollySiteUrl || ( isLocalOnlySite && activeDollySiteId && selectedSite.running )
				),
				reloadNonce: currentState.reloadNonce + 1,
			} ) );
		},
		[ activeDollySiteId, isLocalOnlySite, selectedDollySiteUrl, selectedSite.running ]
	);

	const executeFrontendTool = useCallback(
		async ( toolCall: DollyToolCall ): Promise< DollyToolExecution > => {
			if ( ! isPreviewToolId( toolCall.toolId ) ) {
				return {
					toolResult: {
						toolCallId: toolCall.toolCallId,
						toolId: toolCall.toolId,
						error: `WordPress Studio does not provide a frontend ability named ${ toolCall.toolId }.`,
					},
				};
			}

			const requestedUrl = getStringValue( toolCall.arguments, [ 'url', 'URL', 'uri', 'path' ] );
			if ( ! requestedUrl ) {
				return {
					toolResult: {
						toolCallId: toolCall.toolCallId,
						toolId: toolCall.toolId,
						error: 'Preview needs a valid URL or local site path.',
					},
				};
			}

			const title = getStringValue( toolCall.arguments, [ 'title', 'name' ] );
			const previewBaseUrl = selectedDollySiteUrl ?? getSiteUrl( selectedSite );
			if ( ! selectedDollySiteUrl && ! activeDollySiteId ) {
				return {
					toolResult: {
						toolCallId: toolCall.toolCallId,
						toolId: toolCall.toolId,
						error: 'Preview needs a connected WordPress.com site.',
					},
				};
			}

			const normalizedUrl = normalizePreviewUrl( previewBaseUrl, requestedUrl, {
				autoLoginSameOrigin: ! selectedDollySiteUrl,
			} );
			openPreview( requestedUrl, title );
			const displayTitle = title || new URL( normalizedUrl ).host || normalizedUrl;
			const message = sprintf( __( 'Opened preview: %s' ), displayTitle );

			return {
				toolResult: {
					toolCallId: toolCall.toolCallId,
					toolId: toolCall.toolId,
					result: {
						success: true,
						url: normalizedUrl,
						message,
					},
				},
				agentMessage: message,
			};
		},
		[ activeDollySiteId, openPreview, selectedDollySiteUrl, selectedSite ]
	);

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			const trimmedMessage = chatMessage.trim();
			if ( ! trimmedMessage || ! client || ! activeDollySiteId || isAssistantThinking ) {
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
				executeFrontendTool,
				message: trimmedMessage,
				previewContext,
				siteAssociation,
				selectedSite,
				sessionId,
				siteId: activeDollySiteId,
			} )
				.then( ( response ) => {
					if ( response.sessionId ) {
						setSessionId( response.sessionId );
					}

					if ( response.text.trim() ) {
						setMessages( ( currentMessages ) => [
							...currentMessages,
							generateMessage( response.text, 'assistant', currentMessages.length ),
						] );
					}
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
		[
			client,
			activeDollySiteId,
			executeFrontendTool,
			isAssistantThinking,
			messages.length,
			previewContext,
			siteAssociation,
			selectedSite,
			sessionId,
		]
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
		} else if ( isLoadingSites || isLoadingConnectedSites ) {
			content = String( __( 'Loading Dolly…' ) );
		} else if ( connectedSites.length === 0 ) {
			content = String(
				__(
					'Publish this site to WordPress.com when you want Dolly to manage it. You can still ask Dolly questions about the local site.'
				)
			);
		} else if ( ! activeDollySiteId ) {
			content = String( __( 'Dolly did not return any WordPress.com sites for this account.' ) );
		} else if ( connectedDollySites.length === 0 ) {
			content = String(
				__(
					'This Studio site is connected to WordPress.com, but Dolly is not available for that site.'
				)
			);
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
		! activeDollySiteId ||
		isLoadingSites ||
		isLoadingConnectedSites ||
		isAssistantThinking ||
		hasFailedMessage;
	const showAssistantControls =
		isAuthenticated &&
		! isLoadingSites &&
		! isLoadingConnectedSites &&
		( connectedDollySites.length > 0 || ( isLocalOnlySite && dollySites.length > 0 ) );
	const canShowPreview = Boolean(
		selectedDollySiteUrl || ( isLocalOnlySite && activeDollySiteId )
	);

	return (
		<div className="relative min-h-full flex overflow-hidden">
			<div className="min-w-0 flex-1 flex flex-col" ref={ wrapperRef }>
				{ showAssistantControls && (
					<div className="px-8 pt-4 flex items-end gap-3">
						<div className="min-w-0 flex-1">
							{ connectedDollySites.length > 0 ? (
								<SelectControl
									label={ __( 'WordPress.com site' ) }
									value={ String( selectedDollySiteId ?? '' ) }
									options={ connectedDollySites.map( ( site ) => ( {
										label: site.connectedSite.url
											? `${ site.name } (${ site.connectedSite.url })`
											: site.name,
										value: String( site.id ),
									} ) ) }
									onChange={ ( value ) => setSelectedDollySiteId( Number( value ) ) }
									__nextHasNoMarginBottom
									__next40pxDefaultSize
								/>
							) : (
								<div className="text-xs leading-4 text-frame-text-secondary">
									<div className="a8c-label-semibold text-frame-text">{ selectedSite.name }</div>
									{ __( 'Not connected to WordPress.com' ) }
								</div>
							) }
						</div>
						<Button
							variant={ previewState.open ? 'primary' : 'secondary' }
							disabled={ ! canShowPreview }
							onClick={ () =>
								previewState.open
									? updatePreviewState( { open: false } )
									: openPreview( previewState.pathOrUrl )
							}
							aria-pressed={ previewState.open }
						>
							<Icon icon={ desktop } size={ 18 } />
							{ previewState.open ? __( 'Hide preview' ) : __( 'Show preview' ) }
						</Button>
					</div>
				) }
				<div
					data-testid="assistant-chat"
					className={ cx(
						'min-h-0 flex-1 overflow-y-auto p-8 pb-2 flex flex-col-reverse',
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
			{ previewState.open && (
				<DollyPreviewPanelPortal>
					<DollyPreviewPanel
						selectedSite={ selectedSite }
						previewMode={ previewMode }
						previewState={ previewState }
						previewUrl={ previewUrl }
						onClose={ () => updatePreviewState( { open: false } ) }
						onRefresh={ () =>
							setPreviewState( ( currentState ) => ( {
								...currentState,
								isLoading: Boolean(
									selectedDollySiteUrl ||
										( isLocalOnlySite && activeDollySiteId && selectedSite.running )
								),
								reloadNonce: currentState.reloadNonce + 1,
							} ) )
						}
						onStartSite={
							previewMode === 'local' ? () => getIpcApi().startServer( selectedSite.id ) : undefined
						}
						onUpdateState={ updatePreviewState }
					/>
				</DollyPreviewPanelPortal>
			) }
		</div>
	);
}

export function WpcomSiteAssistant( { selectedWpcomSite }: WpcomSiteAssistantProps ) {
	const inputRef = useRef< HTMLTextAreaElement >( null );
	const wrapperRef = useRef< HTMLDivElement >( null );
	const { isAuthenticated, authenticate, user, client } = useAuth();
	const isOffline = useOffline();
	const [ input, setInput ] = useState( '' );
	const [ messages, setMessages ] = useState< MessageType[] >( [] );
	const [ sessionId, setSessionId ] = useState< string | undefined >();
	const [ isAssistantThinking, setIsAssistantThinking ] = useState( false );
	const [ previewState, setPreviewState ] = useState< DollyPreviewState >( () => ( {
		...initialPreviewState(),
		open: true,
		isLoading: true,
	} ) );
	const selectedSite = useMemo(
		() => createWpcomOnlySiteDetails( selectedWpcomSite ),
		[ selectedWpcomSite ]
	);
	const instanceId = user?.id
		? `dolly_${ user.id }_wpcom_${ selectedWpcomSite.id }`
		: `dolly_wpcom_${ selectedWpcomSite.id }`;
	const previewUrl = useMemo(
		() => normalizePreviewUrl( selectedWpcomSite.url, previewState.pathOrUrl ),
		[ previewState.pathOrUrl, selectedWpcomSite.url ]
	);
	const siteAssociation = useMemo(
		() => createWpcomOnlySiteAssociationContext( selectedWpcomSite ),
		[ selectedWpcomSite ]
	);
	const previewContext = useMemo(
		() => createPreviewContext( selectedSite, previewState, previewUrl ),
		[ previewState, previewUrl, selectedSite ]
	);
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];

	const updatePreviewState = useCallback( ( nextState: Partial< DollyPreviewState > ) => {
		setPreviewState( ( currentState ) => ( { ...currentState, ...nextState } ) );
	}, [] );

	useEffect( () => {
		setInput( '' );
		setMessages( [] );
		setSessionId( undefined );
		setIsAssistantThinking( false );
		setPreviewState( {
			...initialPreviewState(),
			open: true,
			isLoading: true,
		} );
	}, [ selectedWpcomSite.id ] );

	const openPreview = useCallback( ( pathOrUrl = '/', title?: string ) => {
		setPreviewState( ( currentState ) => ( {
			...currentState,
			open: true,
			pathOrUrl,
			title,
			pageTitle: undefined,
			currentUrl: undefined,
			isLoading: true,
			reloadNonce: currentState.reloadNonce + 1,
		} ) );
	}, [] );

	const executeFrontendTool = useCallback(
		async ( toolCall: DollyToolCall ): Promise< DollyToolExecution > => {
			if ( ! isPreviewToolId( toolCall.toolId ) ) {
				return {
					toolResult: {
						toolCallId: toolCall.toolCallId,
						toolId: toolCall.toolId,
						error: `WordPress Studio does not provide a frontend ability named ${ toolCall.toolId }.`,
					},
				};
			}

			const requestedUrl = getStringValue( toolCall.arguments, [ 'url', 'URL', 'uri', 'path' ] );
			if ( ! requestedUrl ) {
				return {
					toolResult: {
						toolCallId: toolCall.toolCallId,
						toolId: toolCall.toolId,
						error: 'Preview needs a valid URL or local site path.',
					},
				};
			}

			const title = getStringValue( toolCall.arguments, [ 'title', 'name' ] );
			const normalizedUrl = normalizePreviewUrl( selectedWpcomSite.url, requestedUrl );
			openPreview( requestedUrl, title );
			const displayTitle = title || new URL( normalizedUrl ).host || normalizedUrl;
			const message = sprintf( __( 'Opened preview: %s' ), displayTitle );

			return {
				toolResult: {
					toolCallId: toolCall.toolCallId,
					toolId: toolCall.toolId,
					result: {
						success: true,
						url: normalizedUrl,
						message,
					},
				},
				agentMessage: message,
			};
		},
		[ openPreview, selectedWpcomSite.url ]
	);

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			const trimmedMessage = chatMessage.trim();
			if ( ! trimmedMessage || ! client || isAssistantThinking ) {
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
				executeFrontendTool,
				message: trimmedMessage,
				previewContext,
				siteAssociation,
				selectedSite,
				sessionId,
				siteId: selectedWpcomSite.id,
			} )
				.then( ( response ) => {
					if ( response.sessionId ) {
						setSessionId( response.sessionId );
					}

					if ( response.text.trim() ) {
						setMessages( ( currentMessages ) => [
							...currentMessages,
							generateMessage( response.text, 'assistant', currentMessages.length ),
						] );
					}
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
		[
			client,
			executeFrontendTool,
			isAssistantThinking,
			messages.length,
			previewContext,
			selectedSite,
			selectedWpcomSite.id,
			sessionId,
			siteAssociation,
		]
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

	const disabled =
		isOffline || ! isAuthenticated || ! client || isAssistantThinking || hasFailedMessage;

	return (
		<div className="relative h-full min-w-0 flex flex-1 overflow-hidden bg-frame-surface">
			<div className="min-w-0 flex-1 flex flex-col" ref={ wrapperRef }>
				<div className="shrink-0 border-b border-a8c-gray-5 bg-white px-8 py-5 flex items-start gap-4">
					<div className="min-w-0 flex-1">
						<h1 className="m-0 truncate text-xl font-semibold text-frame-text">
							{ selectedWpcomSite.name }
						</h1>
						<div className="mt-1 truncate text-sm text-frame-text-secondary">
							{ selectedWpcomSite.url }
						</div>
					</div>
					<Button
						variant={ previewState.open ? 'primary' : 'secondary' }
						onClick={ () =>
							previewState.open
								? updatePreviewState( { open: false } )
								: openPreview( previewState.pathOrUrl )
						}
						aria-pressed={ previewState.open }
					>
						<Icon icon={ desktop } size={ 18 } />
						{ previewState.open ? __( 'Hide preview' ) : __( 'Show preview' ) }
					</Button>
				</div>
				<div
					data-testid="assistant-chat"
					className={ cx(
						'min-h-0 flex-1 overflow-y-auto p-8 pb-2 flex flex-col-reverse',
						! isAuthenticated && 'flex items-start'
					) }
				>
					<div className="mt-auto w-full">
						{ isAuthenticated ? (
							<>
								{ messages.length === 0 && (
									<ChatMessage
										id="message-dolly-welcome"
										message={ generateMessage(
											__( 'Ask Dolly about this WordPress.com site.' ),
											'assistant',
											0
										) }
										instanceId={ instanceId }
									>
										{ __( 'Ask Dolly about this WordPress.com site.' ) }
									</ChatMessage>
								) }
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
			{ previewState.open && (
				<DollyPreviewPanelPortal>
					<DollyPreviewPanel
						selectedSite={ selectedSite }
						previewMode="live"
						previewState={ previewState }
						previewUrl={ previewUrl }
						onClose={ () => updatePreviewState( { open: false } ) }
						onRefresh={ () =>
							setPreviewState( ( currentState ) => ( {
								...currentState,
								isLoading: true,
								reloadNonce: currentState.reloadNonce + 1,
							} ) )
						}
						onUpdateState={ updatePreviewState }
					/>
				</DollyPreviewPanelPortal>
			) }
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
