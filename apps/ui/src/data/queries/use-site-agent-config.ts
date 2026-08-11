import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { InstructionFileType } from '@/data/core';

function agentInstructionsKey( siteId: string ) {
	return [ 'agent-instructions', siteId ] as const;
}

function siteSkillsKey( siteId: string ) {
	return [ 'site-skills', siteId ] as const;
}

export function useAgentInstructionsStatus( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: agentInstructionsKey( siteId ),
		queryFn: () => connector.getAgentInstructionsStatus( siteId ),
	} );
}

export function useInstallAgentInstructions( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( fileType: InstructionFileType ) =>
			connector.installAgentInstructions( siteId, { fileType } ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: agentInstructionsKey( siteId ) } ),
	} );
}

export function useRemoveAgentInstruction( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( fileType: InstructionFileType ) =>
			connector.removeAgentInstruction( siteId, fileType ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: agentInstructionsKey( siteId ) } ),
	} );
}

export function useSiteWordPressSkillsStatus( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: siteSkillsKey( siteId ),
		queryFn: () => connector.getWordPressSkillsStatus( siteId ),
	} );
}

export function useInstallSiteWordPressSkill( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( skillId: string ) => connector.installWordPressSkillById( siteId, skillId ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: siteSkillsKey( siteId ) } ),
	} );
}

export function useRemoveSiteWordPressSkill( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( skillId: string ) => connector.removeWordPressSkillById( siteId, skillId ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: siteSkillsKey( siteId ) } ),
	} );
}
