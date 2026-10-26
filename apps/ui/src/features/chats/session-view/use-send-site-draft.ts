import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useAgentRunStore } from '@/data/agent-runs/context';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	openNewSession,
	primeSessionQueryData,
	SESSIONS_QUERY_KEY,
} from '@/data/queries/use-sessions';
import { useSiteChatDraft } from '@/data/queries/use-site-chat-draft';
import type { SendMessageOptions } from '@/data/agent-runs/store';
import type { AiModelId, AiSessionSummary, LoadedAiSession } from '@/data/core';
import type { AiProviderId } from '@studio/common/ai/providers';

export function useSendSiteDraft( siteId: string | undefined ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const router = useRouter();
	const { startRun } = useAgentRunStore();
	const { draft, update } = useSiteChatDraft( siteId );
	return useCallback(
		async (
			prompt: string,
			options: SendMessageOptions | undefined,
			provider: AiProviderId,
			model: AiModelId
		) => {
			if ( ! siteId ) return;
			const pathname = router.state.location.pathname;
			let summary: AiSessionSummary;
			try {
				summary = draft.sessionId
					? ( await connector.getSession( draft.sessionId ) ).summary
					: await openNewSession( { connector, queryClient }, siteId );
				update( { sessionId: summary.id } );
				await connector.setSessionProvider( summary.id, provider, model );
				await connector.setSessionEnvironment( summary.id, draft.activeEnvironment ?? 'local' );
				const loaded = await connector.getSession( summary.id );
				summary = loaded.summary;
				queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, summary.id ], loaded );
			} catch ( error ) {
				toast.error( error instanceof Error ? error.message : String( error ) );
				throw error;
			}
			await startRun( summary.id, prompt, options );
			const current = queryClient.getQueryData< LoadedAiSession >( [
				...SESSIONS_QUERY_KEY,
				summary.id,
			] )?.summary;
			primeSessionQueryData( queryClient, {
				...( current ?? summary ),
				firstPrompt: current?.firstPrompt || options?.displayMessage || prompt,
				updatedAt: new Date().toISOString(),
			} );
			update( { sessionId: undefined } );
			if ( router.state.location.pathname === pathname ) {
				await router.navigate( { to: '/sessions/$sessionId', params: { sessionId: summary.id } } );
			}
		},
		[
			connector,
			draft.activeEnvironment,
			draft.sessionId,
			queryClient,
			router,
			siteId,
			startRun,
			update,
		]
	);
}
