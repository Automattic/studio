import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector, type AgentApp, type AgentAppId } from '@/data/core';

const AGENT_APPS_QUERY_KEY = [ 'agent-apps' ] as const;

export function useAgentApps() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AGENT_APPS_QUERY_KEY,
		queryFn: () => connector.getAgentApps(),
		// Apps come and go outside Studio, so each visit asks again.
		meta: { persist: false },
		refetchInterval: ( query ) =>
			query.state.data?.some( ( app ) => app.updateStatus === 'updating' ) ? 2_000 : false,
	} );
}

export function useConnectAgentApp() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { id }: { id: AgentAppId; retry: boolean } ) => connector.connectAgentApp( id ),
		onSuccess: ( _result, { id } ) => {
			queryClient.setQueryData< AgentApp[] >(
				AGENT_APPS_QUERY_KEY,
				( apps ) =>
					apps?.map( ( app ) =>
						app.id === id ? { ...app, connected: true, updateStatus: undefined } : app
					)
			);
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: AGENT_APPS_QUERY_KEY } );
		},
	} );
}
