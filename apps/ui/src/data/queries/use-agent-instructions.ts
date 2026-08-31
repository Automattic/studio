import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const AGENT_INSTRUCTIONS_QUERY_KEY = [ 'agent-instructions' ] as const;

export function useAgentInstructions() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AGENT_INSTRUCTIONS_QUERY_KEY,
		queryFn: () => connector.getAgentInstructions(),
		enabled: connector.capabilities.agentInstructions,
		staleTime: Infinity,
	} );
}

export function useSaveAgentInstructions() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( {
			content,
			editSession,
		}: {
			content: string;
			editSession?: { previousContent: string };
		} ) => connector.saveAgentInstructions( content, { editSession } ).then( () => content ),
		onSuccess: ( content ) => {
			queryClient.setQueryData< string >( AGENT_INSTRUCTIONS_QUERY_KEY, content );
		},
	} );
}
