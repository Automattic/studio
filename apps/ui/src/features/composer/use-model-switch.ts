import { normalizeModelEffort, type AiEffort } from '@studio/agent/protocol/model-effort';
import { getAiModelFamily } from '@studio/agent/protocol/models';
import { isStudioCustomEntryOfType } from '@studio/agent/protocol/sessions/entry-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	openNewSession,
	primeSessionQueryData,
	SESSIONS_QUERY_KEY,
} from '@/data/queries/use-sessions';
import { saveComposerDraft } from '@/features/composer/draft-store';
import type { AiModelId, LoadedAiSession, SessionEntry } from '@/data/core';
import type { ComposerAttachment } from '@/data/use-composer-attachments';
import type { AiProviderId } from '@studio/agent/protocol/providers';

function contextEntry( provider: AiProviderId, model: AiModelId, effort: AiEffort ): SessionEntry {
	return {
		type: 'custom',
		id: crypto.randomUUID(),
		parentId: null,
		timestamp: new Date().toISOString(),
		customType: 'studio.session_context',
		data: { provider, model, effort },
	} as SessionEntry;
}

interface ModelSwitchOptions {
	model: AiModelId;
	effort: AiEffort;
	onEffortChange: ( effort: AiEffort ) => void;
	sessionId?: string;
	entries?: SessionEntry[];
	sessionProvider: AiProviderId;
	ownerSiteId?: string;
	onSwitchSession?: ( sessionId: string ) => void;
	onModelChange?: ( model: AiModelId, provider: AiProviderId ) => void;
	isModelLocked: ( id: AiModelId ) => boolean;
	text: string;
	attachments: ComposerAttachment[];
}

export function useModelSwitch( {
	model,
	effort,
	onEffortChange,
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
	const { mutate: saveModel } = useMutation( {
		scope: { id: `session-model-${ sessionId }` },
		mutationFn: ( settings: { provider: AiProviderId; model: AiModelId; effort: AiEffort } ) =>
			settings.provider === sessionProvider
				? connector.setSessionModel( sessionId!, settings.model, settings.effort )
				: connector.setSessionProvider(
						sessionId!,
						settings.provider,
						settings.model,
						settings.effort
				  ),
		onError: ( error ) => {
			toast.error( error instanceof Error ? error.message : String( error ) );
			void queryClient.invalidateQueries( { queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ] } );
		},
	} );
	const [ pending, setPending ] = useState< {
		model: AiModelId;
		provider: AiProviderId;
		effort: AiEffort;
	} | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );
	const changeModel = useCallback(
		( provider: AiProviderId, picked: AiModelId, requestedEffort: AiEffort = 'default' ) => {
			const nextEffort = normalizeModelEffort( picked, requestedEffort );
			if (
				isModelLocked( picked ) ||
				( picked === model && provider === sessionProvider && nextEffort === effort )
			)
				return;
			if ( onModelChange ) {
				onModelChange( picked, provider );
				onEffortChange( nextEffort );
				return;
			}
			if (
				getAiModelFamily( model ) !== getAiModelFamily( picked ) &&
				onSwitchSession &&
				entries?.some( ( entry ) => isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) )
			) {
				setPending( { model: picked, provider, effort: nextEffort } );
				return;
			}
			onEffortChange( nextEffort );
			if ( ! sessionId ) return;
			const key = [ ...SESSIONS_QUERY_KEY, sessionId ];
			queryClient.setQueryData< LoadedAiSession >( key, ( previous ) =>
				previous
					? {
							...previous,
							entries: [ ...previous.entries, contextEntry( provider, picked, nextEffort ) ],
					  }
					: previous
			);
			saveModel( { provider, model: picked, effort: nextEffort } );
		},
		[
			saveModel,
			effort,
			entries,
			isModelLocked,
			model,
			onEffortChange,
			onModelChange,
			onSwitchSession,
			queryClient,
			sessionId,
			sessionProvider,
		]
	);
	const confirmFamilyChange = useCallback( async () => {
		if ( ! pending || ! onSwitchSession ) return;
		setFamilySwitchInFlight( true );
		try {
			const created = await openNewSession( { connector, queryClient }, ownerSiteId );
			await connector.setSessionProvider(
				created.id,
				pending.provider,
				pending.model,
				pending.effort
			);
			primeSessionQueryData( queryClient, created, [
				contextEntry( pending.provider, pending.model, pending.effort ),
			] );
			saveComposerDraft( created.id, { text, attachments, effort: pending.effort } );
			setPending( null );
			onSwitchSession( created.id );
		} catch ( error ) {
			toast.error( error instanceof Error ? error.message : String( error ) );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [ attachments, connector, onSwitchSession, ownerSiteId, pending, queryClient, text ] );
	return {
		changeModel,
		pendingModel: pending?.model ?? null,
		familySwitchInFlight,
		cancelFamilyChange: () => {
			if ( ! familySwitchInFlight ) setPending( null );
		},
		confirmFamilyChange,
	};
}
