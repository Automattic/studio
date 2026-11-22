import { isStudioCustomEntryOfType } from '@studio/agent/protocol/sessions/entry-types';
import { toStoredProviderId, type ProviderId } from '@studio/providers';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	createModelChangeEntry,
	openNewSession,
	primeSessionQueryData,
	SESSIONS_QUERY_KEY,
} from '@/data/queries/use-sessions';
import { saveComposerDraft } from '@/features/composer/draft-store';
import type { AiModelId, LoadedAiSession, SessionEntry } from '@/data/core';
import type { ComposerAttachment } from '@/data/use-composer-attachments';

// Optimistic mirror of the `studio.session_context` entry the backend appends
// for a provider switch, so the picker updates before the write lands.
function createSessionContextEntry( provider: ProviderId, model: AiModelId ): SessionEntry {
	return {
		type: 'custom',
		id: Math.random().toString( 36 ).slice( 2, 10 ),
		parentId: null,
		timestamp: new Date().toISOString(),
		customType: 'studio.session_context',
		data: { provider: toStoredProviderId( provider ), model },
	} as unknown as SessionEntry;
}

interface ModelSwitchOptions {
	model: AiModelId;
	sessionId?: string;
	entries?: SessionEntry[];
	sessionProvider: ProviderId;
	ownerSiteId?: string;
	onSwitchSession?: ( sessionId: string ) => void;
	onModelChange?: ( model: AiModelId, provider: ProviderId ) => void;
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
			void write( sessionId ).catch( () => {
				void queryClient.invalidateQueries( { queryKey } );
			} );
		},
		[ queryClient, sessionId ]
	);

	const applySameFamilyModel = useCallback(
		( picked: AiModelId ) => {
			appendEntryOptimistically( createModelChangeEntry( picked ), ( id ) =>
				connector.setSessionModel( id, picked )
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
		( picked: ProviderId, nextModel: AiModelId ) => {
			if ( model !== nextModel && onSwitchSession && sessionHasTurns ) {
				setPendingFamilyChange( { model: nextModel, provider: picked } );
				return;
			}
			appendEntryOptimistically( createSessionContextEntry( picked, nextModel ), ( id ) =>
				connector.setSessionProvider( id, picked, nextModel )
			);
		},
		[ appendEntryOptimistically, connector, model, onSwitchSession, sessionHasTurns ]
	);

	const changeModel = useCallback(
		( provider: ProviderId, picked: AiModelId ) => {
			if ( picked === model || isModelLocked( picked ) ) {
				return;
			}
			if ( onModelChange ) {
				onModelChange( picked, provider );
				return;
			}
			if ( provider !== sessionProvider ) {
				handleProviderChange( provider, picked );
				return;
			}
			applySameFamilyModel( picked );
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
		const { model: pickedModel, provider: pickedProvider } = pendingFamilyChange;
		setFamilySwitchInFlight( true );
		try {
			const newSession = await openNewSession(
				{ connector, queryClient },
				ownerSiteId,
				pickedProvider ? undefined : pickedModel
			);
			if ( pickedProvider ) {
				// Pin the fresh session to the provider (with a model it
				// serves) before navigating; on failure the user re-picks
				// from the new view's dropdown.
				await connector
					.setSessionProvider( newSession.id, pickedProvider, pickedModel )
					.then( () =>
						primeSessionQueryData( queryClient, newSession, [
							createSessionContextEntry( pickedProvider, pickedModel ),
						] )
					)
					.catch( () => undefined );
			}
			saveComposerDraft( newSession.id, { text, attachments } );
			setPendingFamilyChange( null );
			onSwitchSession( newSession.id );
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

	return {
		changeModel,
		pendingModel: pendingFamilyChange?.model ?? null,
		familySwitchInFlight,
		cancelFamilyChange,
		confirmFamilyChange,
	};
}
