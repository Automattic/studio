import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

// Versioned because persisted query caches from older builds stored a bare string.
export const AGENT_INSTRUCTIONS_QUERY_KEY = [ 'agent-instructions', 2 ] as const;

type AgentInstructions = { content: string; enabled: boolean };

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
			queryClient.setQueryData< AgentInstructions >(
				AGENT_INSTRUCTIONS_QUERY_KEY,
				( current ) => ( {
					content,
					enabled: current?.enabled ?? false,
				} )
			);
		},
	} );
}

export function useSetAgentInstructionsEnabled() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( enabled: boolean ) => connector.setAgentInstructionsEnabled( enabled ),
		onMutate: async ( enabled ) => {
			await queryClient.cancelQueries( { queryKey: AGENT_INSTRUCTIONS_QUERY_KEY } );
			const previous = queryClient.getQueryData< AgentInstructions >(
				AGENT_INSTRUCTIONS_QUERY_KEY
			);
			queryClient.setQueryData< AgentInstructions >( AGENT_INSTRUCTIONS_QUERY_KEY, ( current ) =>
				current ? { ...current, enabled } : current
			);
			return previous;
		},
		onError: ( _error, _enabled, previous ) => {
			queryClient.setQueryData( AGENT_INSTRUCTIONS_QUERY_KEY, previous );
		},
	} );
}
