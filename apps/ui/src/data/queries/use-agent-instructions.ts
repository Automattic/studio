import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

const AGENT_INSTRUCTIONS_QUERY_KEY = [ 'agent-instructions' ] as const;

export function useAgentInstructions() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AGENT_INSTRUCTIONS_QUERY_KEY,
		queryFn: () => connector.getAgentInstructions(),
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

const AGENT_INSTRUCTIONS_ENABLED_QUERY_KEY = [ 'agent-instructions-enabled' ] as const;

export function useAgentInstructionsEnabled() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AGENT_INSTRUCTIONS_ENABLED_QUERY_KEY,
		queryFn: () => connector.getAgentInstructionsEnabled(),
	} );
}

export function useSetAgentInstructionsEnabled() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( enabled: boolean ) => connector.setAgentInstructionsEnabled( enabled ),
		onMutate: ( enabled ) => {
			queryClient.setQueryData( AGENT_INSTRUCTIONS_ENABLED_QUERY_KEY, enabled );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: AGENT_INSTRUCTIONS_ENABLED_QUERY_KEY } );
		},
	} );
}
