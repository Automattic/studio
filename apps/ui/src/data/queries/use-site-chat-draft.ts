import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { AiModelId } from '@/data/core';
import type { AiProviderId } from '@studio/agent/protocol/providers';

interface SiteChatDraft {
	model?: AiModelId;
	provider?: AiProviderId;
	activeEnvironment: 'local' | 'live';
	lastSelectedWpcomSiteId?: number;
	sessionId?: string;
}

const EMPTY_DRAFT: SiteChatDraft = { activeEnvironment: 'local' };

export function useSiteChatDraft( siteId: string | undefined ) {
	const queryClient = useQueryClient();
	const { data: draft } = useQuery< SiteChatDraft >( {
		queryKey: [ 'site-chat-draft', siteId ],
		queryFn: skipToken,
		initialData: EMPTY_DRAFT,
		staleTime: Infinity,
		gcTime: Infinity,
		meta: { persist: false },
	} );
	const update = useCallback(
		( patch: Partial< SiteChatDraft > ) =>
			queryClient.setQueryData< SiteChatDraft >( [ 'site-chat-draft', siteId ], ( draft ) => ( {
				...( draft ?? EMPTY_DRAFT ),
				...patch,
			} ) ),
		[ queryClient, siteId ]
	);
	return { draft: draft ?? EMPTY_DRAFT, update };
}
