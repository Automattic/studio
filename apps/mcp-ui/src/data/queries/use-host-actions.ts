import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { sendMessage, setSiteRunning, updateModelContext } from '@/data/bridge';
import { useHostState } from '@/hooks/use-host-state';
import { canTargetMessages } from '@/lib/host-capabilities';
import { DATA_NOTE, PLUGIN_MENTION } from '@/lib/next-steps';
import { LOCAL_SITES_QUERY_KEY } from './use-library';
import type { LocalSite } from '@/data/types';

const BUSY_KEY = 'busy';

export function useIsBusy() {
	return useIsMutating( { mutationKey: [ BUSY_KEY ] } ) > 0;
}

// A draft (OpenAI hosts only) opens a new chat with it in the chat box, for the
// user to finish; otherwise the prompt is sent right away in the active chat.
export function useSendPrompt() {
	const { capabilities } = useHostState();
	return useMutation( {
		mutationKey: [ BUSY_KEY, 'send-prompt' ],
		mutationFn: ( { prompt, draft }: { prompt: string; draft?: string } ) => {
			const targeted = canTargetMessages( capabilities );
			const asDraft = !! draft && targeted;
			// OpenAI hosts route a message to a plugin through a mention link.
			const mention = targeted && PLUGIN_MENTION ? `${ PLUGIN_MENTION } ` : '';
			return sendMessage( {
				text: mention + ( asDraft ? draft : prompt + DATA_NOTE ),
				openaiTarget: targeted
					? asDraft
						? { target: 'new' }
						: { target: 'active', send: true }
					: undefined,
			} );
		},
	} );
}

export function useSetSiteRunning() {
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: [ BUSY_KEY, 'site-running' ],
		mutationFn: ( { site, running }: { site: LocalSite; running: boolean } ) =>
			setSiteRunning( site.path, running ),
		onSettled: () => queryClient.invalidateQueries( { queryKey: LOCAL_SITES_QUERY_KEY } ),
	} );
}

export function useAddToChat() {
	return useMutation( {
		mutationFn: ( site: LocalSite ) =>
			updateModelContext(
				`A local Studio site the user picked in the WordPress library:\n${ JSON.stringify(
					site
				) }`,
				site.name
			),
	} );
}
