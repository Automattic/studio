import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	logIn,
	openLink,
	readLoginUrl,
	sendMessage,
	setSiteRunning,
	updateModelContext,
} from '@/data/bridge';
import { useHostState } from '@/hooks/use-host-state';
import { canTargetMessages } from '@/lib/host-capabilities';
import { DATA_NOTE, PLUGIN_MENTION } from '@/lib/next-steps';
import { LOCAL_SITES_QUERY_KEY, WPCOM_SITES_QUERY_KEY } from './use-library';
import type { LocalSite, SiteEntry } from '@/data/types';

const BUSY_KEY = 'busy';

export function useIsBusy() {
	return useIsMutating( { mutationKey: [ BUSY_KEY ] } ) > 0;
}

// OpenAI hosts open each prompt as a draft in a new chat (sending one there
// would ask the user to confirm it first); other hosts send it in this chat.
export function useSendPrompt() {
	const { capabilities } = useHostState();
	return useMutation( {
		mutationKey: [ BUSY_KEY, 'send-prompt' ],
		mutationFn: ( { prompt, draft }: { prompt: string; draft?: string } ) => {
			if ( ! canTargetMessages( capabilities ) ) {
				return sendMessage( { text: prompt + DATA_NOTE } );
			}
			// The mention is empty outside a plugin install.
			return sendMessage( {
				text: `${ PLUGIN_MENTION } ${ draft ?? prompt + DATA_NOTE }`.trim(),
				openaiTarget: { target: 'new', send: false },
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
		mutationFn: ( { kind, site }: SiteEntry ) =>
			updateModelContext(
				`A ${
					kind === 'local' ? 'local Studio' : 'WordPress.com'
				} site the user picked in the WordPress library:\n${ JSON.stringify( site ) }`,
				site.name
			),
	} );
}

// WordPress.com's authorization page, which shows a token for useLogIn.
export function useOpenLogin() {
	return useMutation( { mutationFn: async () => openLink( await readLoginUrl() ) } );
}

export function useLogIn() {
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: logIn,
		onSuccess: () => queryClient.invalidateQueries( { queryKey: WPCOM_SITES_QUERY_KEY } ),
	} );
}
