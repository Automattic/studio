import { aiModelRequiresPaidCredits } from '@studio/common/ai/models';
import { AI_PROVIDER_IDS, getEffectiveSessionProvider } from '@studio/common/ai/providers';
import { canUsePaidAiModels } from '@studio/common/lib/studio-assistant-quota';
import { useCallback, useMemo } from 'react';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import type { AiModelId, SessionEntry } from '@/data/core';
import type { AiProviderId } from '@studio/common/ai/providers';

// The provider the chat is on, the providers it can use, and which models are
// out of reach.
export function useModelAccess( {
	sessionId,
	entries,
	provider,
	canChooseProvider = false,
}: {
	sessionId?: string;
	entries?: SessionEntry[];
	provider?: AiProviderId;
	canChooseProvider?: boolean;
} ) {
	const { data: aiSettings } = useAiSettings();
	const sessionProvider = useMemo(
		() => provider ?? getEffectiveSessionProvider( entries ?? [], aiSettings ),
		[ entries, aiSettings, provider ]
	);

	// The paid tiers are listed but disabled for accounts without purchased
	// credits; Automatticians are exempt.
	const { data: quota } = useStudioAssistantQuota( { refetchOnWindowFocus: 'always' } );
	const { data: authUser } = useAuthUser();
	// Connected providers are available in saved chats and site drafts.
	const providers = AI_PROVIDER_IDS.filter(
		( id ) =>
			( id === 'wpcom' ? !! authUser : aiSettings?.hasAnthropicApiKey ) &&
			( !! sessionId || canChooseProvider || id === sessionProvider )
	);
	const canUsePaidTiers = canUsePaidAiModels( quota, authUser?.email );
	const isModelLocked = useCallback(
		( id: AiModelId ) => aiModelRequiresPaidCredits( id ) && ! canUsePaidTiers,
		[ canUsePaidTiers ]
	);

	return { sessionProvider, providers, isModelLocked };
}
