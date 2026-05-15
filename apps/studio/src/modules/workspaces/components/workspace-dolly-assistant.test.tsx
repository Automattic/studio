import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';
import { AuthContext, type AuthContextType } from 'src/components/auth-provider';
import { WorkspaceDollyAssistant } from 'src/modules/workspaces/components/workspace-dolly-assistant';
import {
	createDefaultWorkspacePreviewState,
	type WorkspacePreviewState,
} from 'src/modules/workspaces/components/workspace-preview';
import { hydrateWorkspaceDollyConversationStates } from 'src/modules/workspaces/lib/dolly/api';
import {
	clearWorkspaceDollyAssistantStateCacheForTests,
	getWorkspaceDollyConversationState,
	mergeWorkspaceDollyConversationState,
} from 'src/modules/workspaces/lib/dolly/session';
import type { SyncSite } from '@studio/common/types/sync';
import type { ReactNode } from 'react';
import type { RemoteTarget, RemoteTargetId, StudioWorkspace } from 'src/modules/workspaces/types';
import type { WPCOM } from 'wpcom/types';

vi.mock( '@automattic/agenttic-ui', async () => {
	const React = await vi.importActual< typeof import('react') >( 'react' );

	type MockAgentMessage = {
		id: string;
		content: Array< {
			text?: string;
			component?: React.ComponentType< { images?: Array< { name: string; url: string } > } >;
			componentProps?: { images?: Array< { name: string; url: string } > };
		} >;
	};
	type MockAction = {
		id: string;
		icon: ReactNode;
		onClick: ( event?: React.MouseEvent< HTMLButtonElement > ) => void;
		disabled?: boolean;
		'aria-label': string;
	};
	type MockNotice = {
		message?: string;
		action?: {
			label: string;
			onClick: () => void;
		};
	};
	type MockContainerProps = {
		children?: ReactNode;
		className?: string;
		messages: MockAgentMessage[];
		isProcessing: boolean;
		onSubmit: ( value: string ) => void;
		onStop: () => void;
		inputValue: string;
		onInputChange: ( value: string ) => void;
		placeholder?: string;
		notice?: MockNotice;
	};
	type MockChildrenProps = {
		children?: ReactNode;
		className?: string;
	};
	type MockInputProps = {
		disabled?: boolean;
		customActions?: MockAction[];
	};
	type MockImageUploaderHandle = {
		openFileDialog: () => void;
	};
	type MockImageUploaderProps = {
		images: Array< { id: string; name?: string; url: string } >;
		onFilesSelected: ( files: File[] ) => void;
		onRemoveImage: ( image: { id: string; name?: string; url: string } ) => void;
		acceptedFileTypes?: string[];
	};

	const MockAgentUIContext = React.createContext< MockContainerProps | undefined >( undefined );
	const useMockAgentUIContext = () => {
		const context = React.useContext( MockAgentUIContext );
		if ( ! context ) {
			throw new Error( 'Missing mocked AgentUI context.' );
		}
		return context;
	};

	const Container = ( props: MockContainerProps ) =>
		React.createElement(
			MockAgentUIContext.Provider,
			{ value: props },
			React.createElement( 'div', { className: props.className }, props.children )
		);

	const ConversationView = React.forwardRef< HTMLDivElement, MockChildrenProps >(
		( { children, className }, ref ) => React.createElement( 'div', { ref, className }, children )
	);

	const Messages = () => {
		const { messages, isProcessing } = useMockAgentUIContext();
		return React.createElement(
			'div',
			{ 'data-slot': 'messages' },
			...messages.map( ( message ) =>
				React.createElement(
					'div',
					{ key: message.id },
					message.content.map( ( part, index ) => {
						if ( part.component ) {
							return React.createElement( part.component, {
								key: index,
								...( part.componentProps ?? {} ),
							} );
						}
						return part.text ?? '';
					} )
				)
			),
			isProcessing ? React.createElement( 'div', { key: 'thinking' }, 'Thinking...' ) : null
		);
	};

	const Footer = ( { children, className }: MockChildrenProps ) =>
		React.createElement( 'div', { className }, children );

	const Notice = () => {
		const { notice } = useMockAgentUIContext();
		if ( ! notice?.message ) {
			return null;
		}

		return React.createElement(
			'div',
			null,
			notice.message,
			notice.action
				? React.createElement(
						'button',
						{ type: 'button', onClick: notice.action.onClick },
						notice.action.label
				  )
				: null
		);
	};

	const Input = ( { disabled, customActions = [] }: MockInputProps ) => {
		const { inputValue, isProcessing, onInputChange, onStop, onSubmit, placeholder } =
			useMockAgentUIContext();
		const isSendDisabled = disabled || ( ! inputValue.trim() && ! isProcessing );

		return React.createElement(
			'div',
			null,
			React.createElement( 'textarea', {
				value: inputValue,
				placeholder,
				onChange: ( event: { target: { value: string } } ) => onInputChange( event.target.value ),
				onKeyDown: ( event: KeyboardEvent ) => {
					if ( event.key === 'Enter' && ! isSendDisabled ) {
						event.preventDefault();
						onSubmit( inputValue );
					}
				},
			} ),
			...customActions.map( ( action ) =>
				React.createElement(
					'button',
					{
						key: action.id,
						type: 'button',
						'aria-label': action[ 'aria-label' ],
						disabled: action.disabled,
						onClick: action.onClick,
					},
					action[ 'aria-label' ]
				)
			),
			React.createElement(
				'button',
				{
					type: 'button',
					'aria-label': isProcessing ? 'Stop processing' : 'Send message',
					disabled: isSendDisabled,
					onClick: () => ( isProcessing ? onStop() : onSubmit( inputValue ) ),
				},
				isProcessing ? 'Stop' : 'Send'
			)
		);
	};

	const ImageUploader = React.forwardRef< MockImageUploaderHandle, MockImageUploaderProps >(
		( { images, onFilesSelected, onRemoveImage, acceptedFileTypes }, ref ) => {
			const inputRef = React.useRef< HTMLInputElement >( null );
			React.useImperativeHandle( ref, () => ( {
				openFileDialog: () => inputRef.current?.click(),
			} ) );

			return React.createElement(
				'div',
				null,
				React.createElement( 'input', {
					ref: inputRef,
					type: 'file',
					'aria-label': 'Image upload input',
					accept: acceptedFileTypes?.join( ',' ),
					onChange: ( event: { target: HTMLInputElement } ) => {
						onFilesSelected( Array.from( event.target.files ?? [] ) );
					},
				} ),
				...images.map( ( image ) =>
					React.createElement(
						'button',
						{
							key: image.id,
							type: 'button',
							onClick: () => onRemoveImage( image ),
						},
						image.name ?? image.id
					)
				)
			);
		}
	);

	return {
		AgentUI: {
			Container,
			ConversationView,
			Messages,
			Footer,
			Notice,
			Input,
		},
		ImageUploader,
		createMessageRenderer: vi.fn(),
	};
} );

vi.mock( 'src/hooks/use-offline', () => ( {
	useOffline: () => false,
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		getAuthenticationToken: vi.fn().mockResolvedValue( {
			accessToken: 'test-token',
			expiresIn: 1209600,
			expirationTime: Date.now() + 1209600000,
			id: 1,
			email: 'test@example.com',
			displayName: 'Test User',
		} ),
	} ),
} ) );

const createSyncSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 101,
	localSiteId: '',
	name: 'Production Site',
	url: 'https://production.example',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

const productionSite = createSyncSite( {
	id: 101,
	name: 'Production Site',
	url: 'https://production.example',
	stagingSiteIds: [ 202 ],
} );

const stagingSite = createSyncSite( {
	id: 202,
	name: 'Staging Site',
	url: 'https://staging.example',
	isStaging: true,
	productionSiteId: 101,
} );

const createRemoteTarget = ( id: RemoteTargetId, site: SyncSite ): RemoteTarget => ( {
	id,
	kind: 'remote',
	siteId: site.id,
	site,
} );

const productionTarget = createRemoteTarget( 'production', productionSite );
const stagingTarget = createRemoteTarget( 'staging', stagingSite );

const workspace: StudioWorkspace = {
	id: 'studio-workspace:wpcom:101',
	name: 'Production Site',
	targets: {
		production: productionTarget,
		staging: stagingTarget,
	},
	syncLinks: [],
	activity: { status: 'idle' },
};

type DollyFetchHandler = ( args: {
	body: {
		method?: string;
		params?: {
			id?: string;
			sessionId?: string;
			message?: {
				parts?: Array< {
					type?: string;
					text?: string;
					data?: Record< string, unknown >;
				} >;
			};
		};
	};
	init: RequestInit;
	url: string;
	callIndex: number;
} ) => unknown | Promise< unknown >;

const createDollyFetchResponse = ( data: unknown, requestBody?: { method?: string } ) => {
	if ( requestBody?.method === 'message/stream' ) {
		const encoder = new TextEncoder();
		const stream = new ReadableStream( {
			start( controller ) {
				controller.enqueue( encoder.encode( `data: ${ JSON.stringify( data ) }\n\n` ) );
				controller.close();
			},
		} );

		return new Response( stream, {
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream',
			},
		} );
	}

	return new Response( JSON.stringify( data ), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
		},
	} );
};

const mockDollyFetch = ( handler: DollyFetchHandler ) => {
	const requestBodies: Array< Parameters< DollyFetchHandler >[ 0 ][ 'body' ] > = [];
	const requestUrls: string[] = [];
	const fetchMock = vi.fn( async ( input: RequestInfo | URL, init?: RequestInit ) => {
		const url = String( input );
		const body = JSON.parse( String( init?.body ?? '{}' ) );
		const callIndex = requestBodies.length;
		requestBodies.push( body );
		requestUrls.push( url );

		return createDollyFetchResponse(
			await handler( {
				body,
				init: init ?? {},
				url,
				callIndex,
			} ),
			body
		);
	} );

	vi.stubGlobal( 'fetch', fetchMock );

	return {
		fetchMock,
		requestBodies,
		requestUrls,
	};
};

const createDollyResponse = ( text: string, sessionId: string, taskId = 'task-1' ) => ( {
	jsonrpc: '2.0',
	id: 'rpc-1',
	result: {
		id: taskId,
		sessionId,
		status: {
			state: 'completed',
			message: {
				kind: 'message',
				messageId: `${ taskId }-message`,
				role: 'agent',
				parts: [
					{
						type: 'text',
						text,
					},
				],
			},
		},
	},
} );

const unauthenticatedClient = { req: {} } as unknown as WPCOM;

const renderDollyAssistant = ( {
	target = productionTarget,
	client = unauthenticatedClient,
	previewState = createDefaultWorkspacePreviewState(),
	onUpdatePreviewState = vi.fn(),
}: {
	target?: RemoteTarget;
	client?: WPCOM;
	previewState?: WorkspacePreviewState;
	onUpdatePreviewState?: ( state: WorkspacePreviewState ) => void;
} = {} ) => {
	const authContextValue: AuthContextType = {
		client,
		isAuthenticated: true,
		authenticate: vi.fn(),
		logout: vi.fn().mockResolvedValue( undefined ),
	};

	return render(
		<AuthContext.Provider value={ authContextValue }>
			<WorkspaceDollyAssistant
				key={ target.id }
				workspace={ workspace }
				target={ target }
				previewState={ previewState }
				onUpdatePreviewState={ onUpdatePreviewState }
			/>
		</AuthContext.Provider>
	);
};

const rerenderDollyAssistant = (
	rerender: ReturnType< typeof render >[ 'rerender' ],
	{
		target,
		client = unauthenticatedClient,
		previewState = createDefaultWorkspacePreviewState(),
		onUpdatePreviewState = vi.fn(),
	}: {
		target: RemoteTarget;
		client?: WPCOM;
		previewState?: WorkspacePreviewState;
		onUpdatePreviewState?: ( state: WorkspacePreviewState ) => void;
	}
) => {
	const authContextValue: AuthContextType = {
		client,
		isAuthenticated: true,
		authenticate: vi.fn(),
		logout: vi.fn().mockResolvedValue( undefined ),
	};

	rerender(
		<AuthContext.Provider value={ authContextValue }>
			<WorkspaceDollyAssistant
				key={ target.id }
				workspace={ workspace }
				target={ target }
				previewState={ previewState }
				onUpdatePreviewState={ onUpdatePreviewState }
			/>
		</AuthContext.Provider>
	);
};

const getInput = () => screen.getByRole( 'textbox' );

const getChatMessageText = ( text: string | RegExp ) =>
	screen.getAllByText( text ).find( ( element ) => element.closest( '[data-slot="messages"]' ) ) ??
	screen.getByText( text );

const queryChatMessageText = ( text: string | RegExp ) =>
	screen
		.queryAllByText( text )
		.find( ( element ) => element.closest( '[data-slot="messages"]' ) ) ?? null;

describe( 'WorkspaceDollyAssistant', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		clearWorkspaceDollyAssistantStateCacheForTests();
		localStorage.clear();
		window.HTMLElement.prototype.scrollTo = vi.fn();
		Object.defineProperty( URL, 'createObjectURL', {
			configurable: true,
			value: vi.fn( () => 'blob:workspace-dolly-image' ),
		} );
		Object.defineProperty( URL, 'revokeObjectURL', {
			configurable: true,
			value: vi.fn(),
		} );
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => {
				throw new Error( 'Unexpected fetch request' );
			} )
		);
	} );

	afterAll( () => {
		vi.unstubAllGlobals();
	} );

	it( 'sends Production and Staging chats to different Dolly site endpoints with separate sessions', async () => {
		const { requestBodies, requestUrls } = mockDollyFetch( ( { callIndex } ) =>
			createDollyResponse(
				callIndex === 0 ? 'Production response' : 'Staging response',
				callIndex === 0 ? 'session-production' : 'session-staging',
				callIndex === 0 ? 'task-production' : 'task-staging'
			)
		);
		const { rerender } = renderDollyAssistant( { target: productionTarget } );

		fireEvent.change( getInput(), { target: { value: 'Hello production' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );

		await waitFor( () => {
			expect( getChatMessageText( 'Production response' ) ).toBeVisible();
		} );

		rerenderDollyAssistant( rerender, { target: stagingTarget } );
		fireEvent.change( getInput(), { target: { value: 'Hello staging' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );

		await waitFor( () => {
			expect( getChatMessageText( 'Staging response' ) ).toBeVisible();
		} );

		expect( requestUrls ).toEqual( [
			'https://public-api.wordpress.com/wpcom/v2/sites/101/ai/agent/dolly',
			'https://public-api.wordpress.com/wpcom/v2/sites/202/ai/agent/dolly',
		] );
		expect( requestBodies[ 0 ].params?.sessionId ).toBe( requestBodies[ 0 ].params?.id );
		expect( requestBodies[ 1 ].params?.sessionId ).toBe( requestBodies[ 1 ].params?.id );
		expect( requestBodies[ 1 ].params?.sessionId ).not.toBe( requestBodies[ 0 ].params?.sessionId );
	} );

	it( 'uploads pending images and sends them to Dolly through input actions', async () => {
		const dollyRequestBodies: Array< Record< string, unknown > > = [];
		const mediaRequests: string[] = [];
		const fetchMock = vi.fn( async ( input: RequestInfo | URL, init?: RequestInit ) => {
			const url = String( input );

			if ( url.includes( '/rest/v1.1/sites/101/media/new' ) ) {
				mediaRequests.push( url );
				expect( init?.body ).toBeInstanceOf( FormData );

				return new Response(
					JSON.stringify( {
						media: [
							{
								ID: 777,
								URL: 'https://cdn.example/site-image.png',
								mime_type: 'image/png',
								file: 'site-image.png',
								title: 'site-image',
							},
						],
					} ),
					{
						status: 200,
						headers: {
							'Content-Type': 'application/json',
						},
					}
				);
			}

			const body = JSON.parse( String( init?.body ?? '{}' ) );
			dollyRequestBodies.push( body );
			return createDollyFetchResponse(
				createDollyResponse( 'Image response', 'session-image', 'task-image' ),
				body
			);
		} );
		vi.stubGlobal( 'fetch', fetchMock );
		renderDollyAssistant( { target: productionTarget } );

		expect( screen.getByRole( 'button', { name: 'Upload image' } ) ).toBeVisible();

		const imageFile = new File( [ 'image-bytes' ], 'site-image.png', { type: 'image/png' } );
		fireEvent.change( screen.getByLabelText( 'Image upload input' ), {
			target: { files: [ imageFile ] },
		} );

		await waitFor( () => {
			expect( screen.getByText( 'site-image.png' ) ).toBeVisible();
		} );

		fireEvent.change( getInput(), { target: { value: 'What is in this image?' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );

		await waitFor( () => {
			expect( getChatMessageText( 'Image response' ) ).toBeVisible();
		} );

		expect( mediaRequests ).toEqual( [
			'https://public-api.wordpress.com/rest/v1.1/sites/101/media/new',
		] );
		expect( JSON.stringify( dollyRequestBodies[ 0 ] ) ).toContain(
			'https://cdn.example/site-image.png'
		);
		expect( screen.getByRole( 'button', { name: 'Chat options' } ) ).toBeVisible();
	} );

	it( 'does not show another target messages or draft input when targets switch', async () => {
		const { rerender } = renderDollyAssistant( { target: productionTarget } );

		fireEvent.change( getInput(), { target: { value: 'Production draft' } } );
		expect( getInput() ).toHaveValue( 'Production draft' );

		rerenderDollyAssistant( rerender, { target: stagingTarget } );

		await waitFor( () => {
			expect( getInput() ).toHaveValue( '' );
		} );
		expect( queryChatMessageText( 'Production draft' ) ).not.toBeInTheDocument();

		fireEvent.change( getInput(), { target: { value: 'Staging draft' } } );
		expect( getInput() ).toHaveValue( 'Staging draft' );

		rerenderDollyAssistant( rerender, { target: productionTarget } );

		await waitFor( () => {
			expect( getInput() ).toHaveValue( 'Production draft' );
		} );
		expect( queryChatMessageText( 'Staging draft' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps a hidden target turn alive and restores its response when selected again', async () => {
		let firstRequestSignal: AbortSignal | undefined;
		let resolveFirstRequest: ( value: unknown ) => void = () => {};
		mockDollyFetch( ( { init } ) => {
			firstRequestSignal = init.signal as AbortSignal;
			return new Promise( ( resolve ) => {
				resolveFirstRequest = resolve;
			} );
		} );
		const { rerender } = renderDollyAssistant( { target: productionTarget } );

		fireEvent.change( getInput(), { target: { value: 'Keep working' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );

		await screen.findByRole( 'button', { name: 'Stop processing' } );

		rerenderDollyAssistant( rerender, { target: stagingTarget } );

		expect( firstRequestSignal?.aborted ).toBe( false );

		await act( async () => {
			resolveFirstRequest(
				createDollyResponse(
					'Production finished while hidden',
					'session-production-hidden',
					'task-production-hidden'
				)
			);
		} );

		expect( queryChatMessageText( 'Production finished while hidden' ) ).not.toBeInTheDocument();

		rerenderDollyAssistant( rerender, { target: productionTarget } );

		await waitFor( () => {
			expect( getChatMessageText( 'Production finished while hidden' ) ).toBeVisible();
		} );
	} );

	it( 'hydrates server conversations into the matching workspace target only', async () => {
		const client = {
			req: {
				get: vi.fn( ( { path }, callback ) => {
					if ( path.startsWith( '/ai/chats/wpcom-agent-dolly' ) ) {
						callback( null, [
							{
								chat_id: 301,
								session_id: 'server-production-session',
								site_id: 101,
								created_at: '2026-05-14 13:00:00',
							},
							{
								chat_id: 302,
								session_id: 'server-staging-session',
								site_id: 202,
								created_at: '2026-05-14 14:00:00',
							},
						] );
						return;
					}

					if ( path.startsWith( '/ai/chat/wpcom-agent-dolly/301' ) ) {
						callback( null, {
							chat_id: 301,
							session_id: 'server-production-session',
							site_id: 101,
							messages: [
								{
									role: 'user',
									content: 'Production history question',
									created_at: '2026-05-14 13:00:00',
								},
								{
									role: 'assistant',
									content: 'Production history answer',
									created_at: '2026-05-14 13:01:00',
								},
							],
						} );
						return;
					}

					throw new Error( `Unexpected history path: ${ path }` );
				} ),
			},
		} as unknown as WPCOM;

		const hydratedProductionStates = await hydrateWorkspaceDollyConversationStates( client, {
			workspaceId: workspace.id,
			targetId: 'production',
			site: productionSite,
		} );

		hydratedProductionStates.forEach( ( conversationState ) => {
			mergeWorkspaceDollyConversationState( conversationState, { selectIfEmpty: true } );
		} );

		const productionConversation = getWorkspaceDollyConversationState( {
			workspaceId: workspace.id,
			targetId: 'production',
			site: productionSite,
		} );
		const stagingConversation = getWorkspaceDollyConversationState( {
			workspaceId: workspace.id,
			targetId: 'staging',
			site: stagingSite,
		} );

		expect( productionConversation.messages.map( ( message ) => message.content ) ).toEqual( [
			'Production history question',
			'Production history answer',
		] );
		expect( productionConversation.sessionId ).toBe( 'server-production-session' );
		expect( stagingConversation.messages ).toEqual( [] );
		expect( client.req.get ).not.toHaveBeenCalledWith(
			expect.objectContaining( {
				path: expect.stringContaining( '/302' ),
			} ),
			expect.any( Function )
		);
	} );
} );
