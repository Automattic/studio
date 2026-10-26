import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { AiModelId } from '@/data/core';
import type { AiProviderId } from '@studio/common/ai/providers';

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
	const queryKey = [ 'site-chat-draft', siteId ];
	const { data } = useQuery< SiteChatDraft >( {
		queryKey,
		queryFn: skipToken,
		initialData: EMPTY_DRAFT,
		staleTime: Infinity,
		gcTime: Infinity,
	} );
	const update = useCallback(
		( patch: Partial< SiteChatDraft > ) =>
			queryClient.setQueryData< SiteChatDraft >( [ 'site-chat-draft', siteId ], ( draft ) => ( {
				activeEnvironment: 'local',
				...draft,
				...patch,
			} ) ),
		[ queryClient, siteId ]
	);
	return { draft: data ?? EMPTY_DRAFT, update };
}
