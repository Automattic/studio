import {
	extractTextFromMessage,
	getAgentManager,
	type TaskUpdate,
	type ToolProvider,
} from '@automattic/agenttic-client';
import { __ } from '@wordpress/i18n';
import { createWorkspaceDollyImageUrl } from 'src/modules/workspaces/lib/dolly/media';
import {
	createWorkspaceDollyAgentManagerKey,
	createWorkspaceDollyAgentUrl,
	createWorkspaceDollyAuthProvider,
	createWorkspaceDollyContextProvider,
} from 'src/modules/workspaces/lib/dolly/preview';
import {
	WORKSPACE_DOLLY_AGENT_ID,
	WORKSPACE_DOLLY_MEDIA_RETRY_DELAYS_MS,
	WORKSPACE_DOLLY_REQUEST_TIMEOUT_MS,
	type WorkspaceDollyAgentResponse,
	type WorkspaceDollyPreviewContext,
	type WorkspaceDollySiteAssociationContext,
	type WorkspaceDollyUploadedImage,
} from 'src/modules/workspaces/lib/dolly/types';
import { extractBackendSelectedSiteId } from 'src/modules/workspaces/lib/dolly/utils';
import type { SyncSite } from '@studio/common/types/sync';
import type { RemoteTargetId } from 'src/modules/workspaces/types';

export const getWorkspaceDollyErrorMessage = ( error: unknown ) =>
	error instanceof Error ? error.message : String( error );

export const createWorkspaceDollyRequestAbortError = () => {
	const message = 'Dolly request was stopped.';
	if ( typeof DOMException !== 'undefined' ) {
		return new DOMException( message, 'AbortError' );
	}

	const error = new Error( message );
	error.name = 'AbortError';
	return error;
};

export const isWorkspaceDollyRequestAbortError = ( error: unknown ) =>
	( typeof DOMException !== 'undefined' &&
		error instanceof DOMException &&
		error.name === 'AbortError' ) ||
	( error instanceof Error && error.name === 'AbortError' );

const parseWorkspaceDollyTaskUpdate = (
	response: TaskUpdate,
	fallbackSessionId: string
): WorkspaceDollyAgentResponse => {
	if ( response.status.error ) {
		throw new Error( response.status.error.message || 'Dolly returned an error.' );
	}

	const messageText = response.status.message
		? extractTextFromMessage( response.status.message )
		: response.text;
	const text = messageText.trim();

	return {
		text: text || __( 'Dolly did not return a text response.' ),
		sessionId: response.sessionId ?? fallbackSessionId,
		selectedSiteId: extractBackendSelectedSiteId( response ),
	};
};

const isWorkspaceDollyToolResultProtocolError = ( error: unknown ) => {
	const message = error instanceof Error ? error.message : String( error );
	return (
		message.includes( 'Tool calls without results' ) ||
		message.includes( 'Protocol request error: Invalid message' )
	);
};

const shouldRetryWorkspaceDollyMediaRequest = (
	error: unknown,
	uploadedImages: WorkspaceDollyUploadedImage[]
) =>
	uploadedImages.length > 0 &&
	getWorkspaceDollyErrorMessage( error ).toLowerCase().includes( 'processing the request' );

const delay = ( milliseconds: number, abortSignal?: AbortSignal ) =>
	new Promise< void >( ( resolve, reject ) => {
		if ( abortSignal?.aborted ) {
			reject( createWorkspaceDollyRequestAbortError() );
			return;
		}

		const timeoutId = window.setTimeout( () => {
			abortSignal?.removeEventListener( 'abort', abort );
			resolve();
		}, milliseconds );
		function abort() {
			window.clearTimeout( timeoutId );
			reject( createWorkspaceDollyRequestAbortError() );
		}
		abortSignal?.addEventListener( 'abort', abort, { once: true } );
	} );

export const sendWorkspaceDollyMessage = async ( {
	message,
	uploadedImages,
	previewContext,
	siteAssociation,
	selectedSite,
	sessionId,
	workspaceId,
	targetId,
	toolProvider,
	abortSignal,
}: {
	message: string;
	uploadedImages?: WorkspaceDollyUploadedImage[];
	previewContext: WorkspaceDollyPreviewContext;
	siteAssociation: WorkspaceDollySiteAssociationContext;
	selectedSite: SyncSite;
	sessionId?: string;
	workspaceId: string;
	targetId: RemoteTargetId;
	toolProvider?: ToolProvider;
	abortSignal?: AbortSignal;
} ): Promise< WorkspaceDollyAgentResponse > => {
	const taskId = crypto.randomUUID();
	const initialSessionId = sessionId ?? taskId;
	const agentManager = getAgentManager();
	const agentManagerKey = createWorkspaceDollyAgentManagerKey(
		workspaceId,
		targetId,
		selectedSite.id
	);
	const sendInitialMessage = async ( nextTaskId: string, nextSessionId: string ) => {
		agentManager.removeAgent( agentManagerKey );
		await agentManager.createAgent( agentManagerKey, {
			agentId: WORKSPACE_DOLLY_AGENT_ID,
			agentUrl: createWorkspaceDollyAgentUrl( selectedSite.id ),
			authProvider: createWorkspaceDollyAuthProvider(),
			contextProvider: createWorkspaceDollyContextProvider(
				workspaceId,
				targetId,
				selectedSite,
				previewContext,
				siteAssociation
			),
			toolProvider,
			timeout: WORKSPACE_DOLLY_REQUEST_TIMEOUT_MS,
		} );

		try {
			let finalUpdate: TaskUpdate | undefined;
			for await ( const update of agentManager.sendMessageStream( agentManagerKey, message, {
				imageUrls: uploadedImages?.map( createWorkspaceDollyImageUrl ),
				sessionId: nextSessionId,
				taskId: nextTaskId,
				abortSignal,
				enableStreaming: false,
			} ) ) {
				finalUpdate = update;
			}

			if ( ! finalUpdate ) {
				throw new Error( __( 'Dolly did not return a response.' ) );
			}

			return parseWorkspaceDollyTaskUpdate( finalUpdate, nextSessionId );
		} finally {
			try {
				await agentManager.resetConversation( agentManagerKey );
			} catch {
				// The workspace Dolly cache is the source of truth between requests.
			}
			agentManager.removeAgent( agentManagerKey );
		}
	};

	let response: WorkspaceDollyAgentResponse | undefined;
	try {
		for ( let attempt = 0; ; attempt++ ) {
			try {
				response = await sendInitialMessage( taskId, initialSessionId );
				break;
			} catch ( error ) {
				if (
					attempt >= WORKSPACE_DOLLY_MEDIA_RETRY_DELAYS_MS.length ||
					! shouldRetryWorkspaceDollyMediaRequest( error, uploadedImages ?? [] )
				) {
					throw error;
				}
				await delay( WORKSPACE_DOLLY_MEDIA_RETRY_DELAYS_MS[ attempt ], abortSignal );
			}
		}
	} catch ( error ) {
		if (
			isWorkspaceDollyRequestAbortError( error ) ||
			abortSignal?.aborted ||
			! sessionId ||
			! isWorkspaceDollyToolResultProtocolError( error )
		) {
			throw error;
		}

		const freshTaskId = crypto.randomUUID();
		response = await sendInitialMessage( freshTaskId, freshTaskId );
	}

	if ( ! response ) {
		throw new Error( __( 'Dolly did not return a response.' ) );
	}

	return response;
};
