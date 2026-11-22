import { isStudioCustomEntryOfType } from '@studio/agent/protocol/sessions/entry-types';
import { toStoredProviderId, type ProviderId } from '@studio/providers';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useCallback, useMemo, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	clearFailedSessionModelWrite,
	queueSessionModelWrite,
	waitForSessionModelWrites,
} from '@/data/queries/session-model-writes';
import {
	createModelChangeEntry,
	openNewSession,
	primeSessionQueryData,
	SESSIONS_QUERY_KEY,
} from '@/data/queries/use-sessions';
import { saveComposerDraft } from '@/features/composer/draft-store';
import type { AiModelId, LoadedAiSession, SessionEntry } from '@/data/core';
import type { ComposerAttachment } from '@/data/use-composer-attachments';
import type { ThinkingSetting } from '@studio/agent/protocol/thinking';

// Optimistic mirror of the `studio.session_context` entry the backend appends
// for a provider switch, so the picker updates before the write lands.
function createSessionContextEntry(
	provider: ProviderId | undefined,
	model: AiModelId,
	thinking?: ThinkingSetting
): SessionEntry {
	return {
		type: 'custom',
		id: Math.random().toString( 36 ).slice( 2, 10 ),
		parentId: null,
		timestamp: new Date().toISOString(),
		customType: 'studio.session_context',
		data: {
			...( provider ? { provider: toStoredProviderId( provider ) } : {} ),
			model,
			...( thinking ? { thinking } : {} ),
		},
	} as unknown as SessionEntry;
}

interface ModelSwitchOptions {
	model: AiModelId;
	sessionId?: string;
	entries?: SessionEntry[];
	sessionProvider: ProviderId;
	ownerSiteId?: string;
	onSwitchSession?: ( sessionId: string ) => void;
	onModelChange?: ( model: AiModelId, provider: ProviderId, thinking?: ThinkingSetting ) => void;
	isModelLocked: ( id: AiModelId ) => boolean;
	// The draft carried over to a fresh session.
	text: string;
	attachments: ComposerAttachment[];
}

export function useModelSwitch( {
	model,
	sessionId,
	entries,
	sessionProvider,
	ownerSiteId,
	onSwitchSession,
	onModelChange,
	isModelLocked,
	text,
	attachments,
}: ModelSwitchOptions ) {
	const connector = useConnector();
	const queryClient = useQueryClient();

	// Cross-family swap state: the picked model (and provider, for a provider
	// switch) waits here while the confirmation dialog is open; nothing is
	// persisted until the user confirms.
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< {
		model: AiModelId;
		provider?: ProviderId;
		thinking?: ThinkingSetting;
	} | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

	// Show the entry right away, then write it; refetch on write fail so the
	// transcript falls back to what actually landed.
	const appendEntryOptimistically = useCallback(
		( entry: SessionEntry, write: ( id: string ) => Promise< void > ) => {
			if ( ! sessionId ) {
				return;
			}
			const queryKey = [ ...SESSIONS_QUERY_KEY, sessionId ];
			queryClient.setQueryData< LoadedAiSession >( queryKey, ( prev ) =>
				prev ? { ...prev, entries: [ ...( prev.entries ?? [] ), entry ] } : prev
			);
			const next = queueSessionModelWrite( sessionId, () => write( sessionId ) );
			void next.catch( ( error: unknown ) => {
				toast.error( __( 'Couldn’t change the chat model' ), {
					description: error instanceof Error ? error.message : String( error ),
				} );
				void queryClient.invalidateQueries( { queryKey } ).then(
					() => clearFailedSessionModelWrite( sessionId, next ),
					() => clearFailedSessionModelWrite( sessionId, next )
				);
			} );
		},
		[ queryClient, sessionId ]
	);

	const applySameFamilyModel = useCallback(
		( picked: AiModelId, thinking?: ThinkingSetting ) => {
			appendEntryOptimistically(
				thinking === undefined
					? createModelChangeEntry( picked )
					: createSessionContextEntry( undefined, picked, thinking ),
				( id ) =>
					thinking === undefined
						? connector.setSessionModel( id, picked )
						: connector.setSessionModel( id, picked, thinking )
			);
		},
		[ appendEntryOptimistically, connector ]
	);

	const sessionHasTurns = useMemo(
		() =>
			( entries ?? [] ).some( ( entry ) =>
				isStudioCustomEntryOfType( entry, 'studio.user_prompt' )
			),
		[ entries ]
	);

	// Pin this conversation to a provider and one of its models in the same
	// entry. Moving the conversation to another model goes through the
	// fresh-session confirmation.
	const handleProviderChange = useCallback(
		( picked: ProviderId, nextModel: AiModelId, thinking?: ThinkingSetting ) => {
			if (
				picked !== sessionProvider &&
				model !== nextModel &&
				onSwitchSession &&
				sessionHasTurns
			) {
				setPendingFamilyChange( { model: nextModel, provider: picked, thinking } );
				return;
			}
			appendEntryOptimistically(
				createSessionContextEntry( picked, nextModel, thinking ),
				( id ) =>
					thinking === undefined
						? connector.setSessionProvider( id, picked, nextModel )
						: connector.setSessionProvider( id, picked, nextModel, thinking )
			);
		},
		[
			appendEntryOptimistically,
			connector,
			model,
			onSwitchSession,
			sessionHasTurns,
			sessionProvider,
		]
	);

	const changeModel = useCallback(
		( provider: ProviderId, picked: AiModelId, thinking?: ThinkingSetting ) => {
			if (
				( picked === model && provider === sessionProvider && thinking === undefined ) ||
				isModelLocked( picked )
			) {
				return;
			}
			if ( onModelChange ) {
				if ( thinking === undefined ) onModelChange( picked, provider );
				else onModelChange( picked, provider, thinking );
				return;
			}
			if ( provider !== sessionProvider ) {
				handleProviderChange( provider, picked, thinking );
				return;
			}
			applySameFamilyModel( picked, thinking );
		},
		[
			applySameFamilyModel,
			handleProviderChange,
			isModelLocked,
			model,
			onModelChange,
			sessionProvider,
		]
	);

	const cancelFamilyChange = useCallback( () => {
		if ( familySwitchInFlight ) {
			return;
		}
		setPendingFamilyChange( null );
	}, [ familySwitchInFlight ] );

	const confirmFamilyChange = useCallback( async () => {
		if ( ! pendingFamilyChange || ! onSwitchSession ) {
			return;
		}
		const {
			model: pickedModel,
			provider: pickedProvider,
			thinking: pickedThinking,
		} = pendingFamilyChange;
		setFamilySwitchInFlight( true );
		try {
			const newSession = await openNewSession(
				{ connector, queryClient },
				ownerSiteId,
				pickedProvider ? undefined : pickedModel
			);
			if ( pickedProvider ) {
				if ( pickedThinking === undefined ) {
					await connector.setSessionProvider( newSession.id, pickedProvider, pickedModel );
				} else {
					await connector.setSessionProvider(
						newSession.id,
						pickedProvider,
						pickedModel,
						pickedThinking
					);
				}
				primeSessionQueryData( queryClient, newSession, [
					createSessionContextEntry( pickedProvider, pickedModel, pickedThinking ),
				] );
			}
			saveComposerDraft( newSession.id, { text, attachments } );
			setPendingFamilyChange( null );
			onSwitchSession( newSession.id );
		} catch ( error ) {
			toast.error( __( 'Couldn’t change the chat model' ), {
				description: error instanceof Error ? error.message : String( error ),
			} );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [
		attachments,
		connector,
		onSwitchSession,
		ownerSiteId,
		pendingFamilyChange,
		queryClient,
		text,
	] );

	const waitForModelChange = useCallback(
		() => ( sessionId ? waitForSessionModelWrites( sessionId ) : Promise.resolve() ),
		[ sessionId ]
	);

	return {
		changeModel,
		waitForModelChange,
		pendingModel: pendingFamilyChange?.model ?? null,
		familySwitchInFlight,
		cancelFamilyChange,
		confirmFamilyChange,
	};
}
