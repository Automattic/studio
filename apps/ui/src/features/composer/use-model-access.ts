import { aiModelRequiresPaidCredits } from '@studio/common/ai/models';
import { AI_PROVIDER_IDS, getEffectiveSessionProvider } from '@studio/common/ai/providers';
import { canUsePaidAiModels } from '@studio/common/lib/studio-assistant-quota';
import { useCallback, useMemo } from 'react';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import type { AiModelId, SessionEntry } from '@/data/core';

// The provider the chat is on, the providers it can use, and which models are
// out of reach.
export function useModelAccess( {
	sessionId,
	entries,
}: {
	sessionId?: string;
	entries?: SessionEntry[];
} ) {
	const { data: aiSettings } = useAiSettings();
	const sessionProvider = useMemo(
		() => getEffectiveSessionProvider( entries ?? [], aiSettings ),
		[ entries, aiSettings ]
	);

	// The paid tiers are listed but disabled for accounts without purchased
	// credits; Automatticians are exempt.
	const { data: quota } = useStudioAssistantQuota( { refetchOnWindowFocus: 'always' } );
	const { data: authUser } = useAuthUser();
	// The providers this chat can use; another provider's model starts a new
	// chat, which needs a session to come from.
	const providers = AI_PROVIDER_IDS.filter(
		( id ) =>
			( id === 'wpcom' ? !! authUser : aiSettings?.hasAnthropicApiKey ) &&
			( !! sessionId || id === sessionProvider )
	);
	const canUsePaidTiers = canUsePaidAiModels( quota, authUser?.email );
	const isModelLocked = useCallback(
		( id: AiModelId ) => aiModelRequiresPaidCredits( id ) && ! canUsePaidTiers,
		[ canUsePaidTiers ]
	);

	return { sessionProvider, providers, isModelLocked };
}
