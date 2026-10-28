import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useAgentRunStore } from '@/data/agent-runs/context';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { primeSessionQueryData, SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { useSiteChatDraft } from '@/data/queries/use-site-chat-draft';
import type { SendMessageOptions } from '@/data/agent-runs/store';
import type { AiModelId, LoadedAiSession } from '@/data/core';
import type { AiProviderId } from '@studio/agent/protocol/providers';

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
			let session: LoadedAiSession;
			try {
				const sessionId = draft.sessionId ?? ( await connector.createSession( siteId ) ).id;
				update( { sessionId } );
				await connector.setSessionProvider( sessionId, provider, model );
				await connector.setSessionEnvironment( sessionId, draft.activeEnvironment );
				session = await connector.getSession( sessionId );
				queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, sessionId ], session );
			} catch ( error ) {
				toast.error( error instanceof Error ? error.message : String( error ) );
				throw error;
			}
			const { id: sessionId } = session.summary;
			await startRun( sessionId, prompt, options );
			const current = queryClient.getQueryData< LoadedAiSession >( [
				...SESSIONS_QUERY_KEY,
				sessionId,
			] )?.summary;
			primeSessionQueryData( queryClient, {
				...( current ?? session.summary ),
				firstPrompt: current?.firstPrompt || options?.displayMessage || prompt,
				updatedAt: new Date().toISOString(),
			} );
			update( { sessionId: undefined } );
			if ( router.state.location.pathname === pathname ) {
				await router.navigate( { to: '/sessions/$sessionId', params: { sessionId } } );
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
