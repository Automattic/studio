import {
	extractTextFromMessage,
	getAgentManager,
	type TaskUpdate,
	type ToolProvider,
} from '@automattic/agenttic-client';
import { __ } from '@wordpress/i18n';
import { extractBackendSelectedSiteId } from 'src/modules/wpcom-site-assistant/lib/api';
import {
	createDollyImageUrl,
	createDollyRequestAbortError,
} from 'src/modules/wpcom-site-assistant/lib/media';
import {
	createDollyAgentManagerKey,
	createDollyAgentUrl,
	createDollyAuthProvider,
	createDollyContextProvider,
} from 'src/modules/wpcom-site-assistant/lib/preview';
import {
	DOLLY_AGENT_ID,
	DOLLY_MEDIA_RETRY_DELAYS_MS,
	DOLLY_REQUEST_TIMEOUT_MS,
	type DollyAgentResponse,
	type DollyPreviewContext,
	type DollySiteAssociationContext,
	type DollyUploadedImage,
} from 'src/modules/wpcom-site-assistant/lib/types';
import type { SyncSite } from '@studio/common/types/sync';

export const getErrorMessage = ( error: unknown ) =>
	error instanceof Error ? error.message : String( error );

export const isDollyRequestAbortError = ( error: unknown ) =>
	( typeof DOMException !== 'undefined' &&
		error instanceof DOMException &&
		error.name === 'AbortError' ) ||
	( error instanceof Error && error.name === 'AbortError' );

export const shouldRetryDollyMediaRequest = (
	error: unknown,
	uploadedImages: DollyUploadedImage[]
) =>
	uploadedImages.length > 0 &&
	getErrorMessage( error ).toLowerCase().includes( 'processing the request' );

export const delay = ( milliseconds: number, abortSignal?: AbortSignal ) =>
	new Promise< void >( ( resolve, reject ) => {
		if ( abortSignal?.aborted ) {
			reject( createDollyRequestAbortError() );
			return;
		}

		const timeoutId = window.setTimeout( () => {
			abortSignal?.removeEventListener( 'abort', abort );
			resolve();
		}, milliseconds );
		function abort() {
			window.clearTimeout( timeoutId );
			reject( createDollyRequestAbortError() );
		}
		abortSignal?.addEventListener( 'abort', abort, { once: true } );
	} );

export const parseDollyTaskUpdate = (
	response: TaskUpdate,
	fallbackSessionId: string
): DollyAgentResponse => {
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

export const isDollyToolResultProtocolError = ( error: unknown ) => {
	const message = error instanceof Error ? error.message : String( error );
	return (
		message.includes( 'Tool calls without results' ) ||
		message.includes( 'Protocol request error: Invalid message' )
	);
};

export const sendDollyMessage = async ( {
	message,
	uploadedImages,
	previewContext,
	siteAssociation,
	selectedSite,
	sessionId,
	siteId,
	toolProvider,
	abortSignal,
}: {
	message: string;
	uploadedImages?: DollyUploadedImage[];
	previewContext?: DollyPreviewContext;
	siteAssociation?: DollySiteAssociationContext;
	selectedSite: SyncSite;
	sessionId?: string;
	siteId: number;
	toolProvider?: ToolProvider;
	abortSignal?: AbortSignal;
} ): Promise< DollyAgentResponse > => {
	const taskId = crypto.randomUUID();
	const initialSessionId = sessionId ?? taskId;
	const agentManager = getAgentManager();
	const agentManagerKey = createDollyAgentManagerKey( siteId );
	const sendInitialMessage = async ( nextTaskId: string, nextSessionId: string ) => {
		agentManager.removeAgent( agentManagerKey );
		await agentManager.createAgent( agentManagerKey, {
			agentId: DOLLY_AGENT_ID,
			agentUrl: createDollyAgentUrl( siteId ),
			authProvider: createDollyAuthProvider(),
			contextProvider: createDollyContextProvider(
				siteId,
				selectedSite,
				previewContext,
				siteAssociation
			),
			toolProvider,
			timeout: DOLLY_REQUEST_TIMEOUT_MS,
		} );

		try {
			let finalUpdate: TaskUpdate | undefined;
			for await ( const update of agentManager.sendMessageStream( agentManagerKey, message, {
				imageUrls: uploadedImages?.map( createDollyImageUrl ),
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

			return parseDollyTaskUpdate( finalUpdate, nextSessionId );
		} finally {
			try {
				await agentManager.resetConversation( agentManagerKey );
			} catch {
				// The Studio session cache is the source of truth; Agenttic manager state is per-request.
			}
			agentManager.removeAgent( agentManagerKey );
		}
	};
	let response: DollyAgentResponse | undefined;
	try {
		for ( let attempt = 0; ; attempt++ ) {
			try {
				response = await sendInitialMessage( taskId, initialSessionId );
				break;
			} catch ( error ) {
				if (
					attempt >= DOLLY_MEDIA_RETRY_DELAYS_MS.length ||
					! shouldRetryDollyMediaRequest( error, uploadedImages ?? [] )
				) {
					throw error;
				}
				await delay( DOLLY_MEDIA_RETRY_DELAYS_MS[ attempt ], abortSignal );
			}
		}
	} catch ( error ) {
		if (
			isDollyRequestAbortError( error ) ||
			abortSignal?.aborted ||
			! sessionId ||
			! isDollyToolResultProtocolError( error )
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
