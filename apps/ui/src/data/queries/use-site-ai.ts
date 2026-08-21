import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { InstructionFileType, SiteAgentInstructionStatus, SkillStatus } from '@/data/core';

export const siteSkillsQueryKey = ( siteId: string ) => [ 'site-skills', siteId ] as const;
export const siteAgentInstructionsQueryKey = ( siteId: string ) =>
	[ 'site-agent-instructions', siteId ] as const;

export function useSiteSkills( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: siteSkillsQueryKey( siteId ),
		queryFn: () => connector.getSiteSkillsStatus( siteId ),
		enabled: connector.capabilities.siteAgentSkills,
	} );
}

// Flip installed state in the cache up front so toggles respond instantly
// (FormToggle has no pending state); mutations roll back with the returned
// snapshot on error and re-sync from the connector on settled.
function useOptimisticSiteSkillsInstalled( siteId: string ) {
	const queryClient = useQueryClient();
	return async ( skillIds: string[], installed: boolean ) => {
		const queryKey = siteSkillsQueryKey( siteId );
		await queryClient.cancelQueries( { queryKey } );
		const previous = queryClient.getQueryData< SkillStatus[] >( queryKey );
		queryClient.setQueryData< SkillStatus[] >(
			queryKey,
			( skills ) =>
				skills?.map( ( skill ) =>
					skillIds.includes( skill.id ) ? { ...skill, installed } : skill
				)
		);
		return previous;
	};
}

export function useInstallSiteSkill( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticSiteSkillsInstalled( siteId );
	return useMutation( {
		mutationFn: ( skillId: string ) => connector.installSiteSkill( siteId, skillId ),
		onMutate: ( skillId ) => applyOptimistic( [ skillId ], true ),
		onError: ( _error, _skillId, previous ) => {
			queryClient.setQueryData( siteSkillsQueryKey( siteId ), previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: siteSkillsQueryKey( siteId ) } );
		},
	} );
}

export function useInstallAllSiteSkills( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticSiteSkillsInstalled( siteId );
	return useMutation( {
		mutationFn: async ( skillIds: string[] ) => {
			for ( const skillId of skillIds ) {
				await connector.installSiteSkill( siteId, skillId );
			}
		},
		onMutate: ( skillIds ) => applyOptimistic( skillIds, true ),
		onError: ( _error, _skillIds, previous ) => {
			queryClient.setQueryData( siteSkillsQueryKey( siteId ), previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: siteSkillsQueryKey( siteId ) } );
		},
	} );
}

export function useRemoveSiteSkill( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticSiteSkillsInstalled( siteId );
	return useMutation( {
		mutationFn: ( skillId: string ) => connector.removeSiteSkill( siteId, skillId ),
		onMutate: ( skillId ) => applyOptimistic( [ skillId ], false ),
		onError: ( _error, _skillId, previous ) => {
			queryClient.setQueryData( siteSkillsQueryKey( siteId ), previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: siteSkillsQueryKey( siteId ) } );
		},
	} );
}

export function useSiteAgentInstructions( siteId: string ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: siteAgentInstructionsQueryKey( siteId ),
		queryFn: () => connector.getSiteAgentInstructionsStatus( siteId ),
		enabled: connector.capabilities.siteAgentSkills,
	} );
}

function useOptimisticSiteInstructionsInstalled( siteId: string ) {
	const queryClient = useQueryClient();
	return async ( fileTypes: InstructionFileType[], installed: boolean ) => {
		const queryKey = siteAgentInstructionsQueryKey( siteId );
		await queryClient.cancelQueries( { queryKey } );
		const previous = queryClient.getQueryData< SiteAgentInstructionStatus[] >( queryKey );
		queryClient.setQueryData< SiteAgentInstructionStatus[] >(
			queryKey,
			( statuses ) =>
				statuses?.map( ( status ) =>
					fileTypes.includes( status.id ) ? { ...status, installed } : status
				)
		);
		return previous;
	};
}

export function useInstallSiteAgentInstructionFile( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticSiteInstructionsInstalled( siteId );
	return useMutation( {
		mutationFn: ( fileType: InstructionFileType ) =>
			connector.installSiteAgentInstructionFile( siteId, fileType ),
		onMutate: ( fileType ) => applyOptimistic( [ fileType ], true ),
		onError: ( _error, _fileType, previous ) => {
			queryClient.setQueryData( siteAgentInstructionsQueryKey( siteId ), previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: siteAgentInstructionsQueryKey( siteId ) } );
		},
	} );
}

export function useInstallAllSiteAgentInstructionFiles( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticSiteInstructionsInstalled( siteId );
	return useMutation( {
		mutationFn: async ( fileTypes: InstructionFileType[] ) => {
			for ( const fileType of fileTypes ) {
				await connector.installSiteAgentInstructionFile( siteId, fileType );
			}
		},
		onMutate: ( fileTypes ) => applyOptimistic( fileTypes, true ),
		onError: ( _error, _fileTypes, previous ) => {
			queryClient.setQueryData( siteAgentInstructionsQueryKey( siteId ), previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: siteAgentInstructionsQueryKey( siteId ) } );
		},
	} );
}

export function useRemoveSiteAgentInstructionFile( siteId: string ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticSiteInstructionsInstalled( siteId );
	return useMutation( {
		mutationFn: ( fileType: InstructionFileType ) =>
			connector.removeSiteAgentInstructionFile( siteId, fileType ),
		onMutate: ( fileType ) => applyOptimistic( [ fileType ], false ),
		onError: ( _error, _fileType, previous ) => {
			queryClient.setQueryData( siteAgentInstructionsQueryKey( siteId ), previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: siteAgentInstructionsQueryKey( siteId ) } );
		},
	} );
}
