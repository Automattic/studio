import { getEffectiveSessionProvider } from '@studio/agent/protocol/sessions/model';
import { canUsePaidAiModels } from '@studio/common/lib/studio-assistant-quota';
import { getAiModel, PROVIDER_IDS } from '@studio/providers';
import { useCallback, useMemo } from 'react';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import type { AiModelId, SessionEntry } from '@/data/core';
import type { ProviderId } from '@studio/providers';

// The provider the chat is on, the providers it can use, and which models are
// out of reach.
export function useModelAccess( {
	sessionId,
	entries,
	provider,
}: {
	sessionId?: string;
	entries?: SessionEntry[];
	provider?: ProviderId;
} ) {
	const { data: aiSettings } = useAiSettings();
	const sessionProvider = useMemo(
		() => provider ?? getEffectiveSessionProvider( entries ?? [], aiSettings ),
		[ entries, aiSettings, provider ]
	);

	// The paid tiers are listed but disabled for accounts that have never
	// bought credits; Automatticians are exempt.
	const { data: quota } = useStudioAssistantQuota( { refetchOnWindowFocus: 'always' } );
	const { data: authUser } = useAuthUser();
	// Connected providers are available in saved chats and site drafts.
	const providers = PROVIDER_IDS.filter(
		( id ) =>
			aiSettings?.accounts[ id ].connected &&
			( !! sessionId || !! provider || id === sessionProvider )
	);
	const canUsePaidTiers = canUsePaidAiModels( quota, authUser?.email );
	const isModelLocked = useCallback(
		( id: AiModelId ) =>
			Boolean( getAiModel( sessionProvider, id )?.requiresPaidAiCredits ) && ! canUsePaidTiers,
		[ canUsePaidTiers, sessionProvider ]
	);

	return { sessionProvider, providers, isModelLocked };
}
