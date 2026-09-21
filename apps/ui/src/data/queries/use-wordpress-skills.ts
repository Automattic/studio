import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SkillStatus } from '@/data/core';

export const WORDPRESS_SKILLS_QUERY_KEY = [ 'wordpress-skills' ] as const;

export function useWordPressSkills() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WORDPRESS_SKILLS_QUERY_KEY,
		queryFn: () => connector.getWordPressSkillsStatusAllSites(),
	} );
}

// Flip installed state in the cache up front so toggles respond instantly
// (FormToggle has no pending state); mutations roll back with the returned
// snapshot on error and re-sync from the connector on settled.
function useOptimisticInstalled() {
	const queryClient = useQueryClient();
	return async ( skillIds: string[], installed: boolean ) => {
		await queryClient.cancelQueries( { queryKey: WORDPRESS_SKILLS_QUERY_KEY } );
		const previous = queryClient.getQueryData< SkillStatus[] >( WORDPRESS_SKILLS_QUERY_KEY );
		queryClient.setQueryData< SkillStatus[] >(
			WORDPRESS_SKILLS_QUERY_KEY,
			( skills ) =>
				skills?.map( ( skill ) =>
					skillIds.includes( skill.id ) ? { ...skill, installed } : skill
				)
		);
		return previous;
	};
}

export function useInstallWordPressSkill() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticInstalled();
	return useMutation( {
		mutationFn: ( skillId: string ) => connector.installWordPressSkillToAllSites( skillId ),
		onMutate: ( skillId ) => applyOptimistic( [ skillId ], true ),
		onError: ( _error, _skillId, previous ) => {
			queryClient.setQueryData( WORDPRESS_SKILLS_QUERY_KEY, previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: WORDPRESS_SKILLS_QUERY_KEY } );
		},
	} );
}

export function useInstallAllWordPressSkills() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticInstalled();
	return useMutation( {
		mutationFn: async ( skillIds: string[] ) => {
			for ( const skillId of skillIds ) {
				await connector.installWordPressSkillToAllSites( skillId );
			}
		},
		onMutate: ( skillIds ) => applyOptimistic( skillIds, true ),
		onError: ( _error, _skillIds, previous ) => {
			queryClient.setQueryData( WORDPRESS_SKILLS_QUERY_KEY, previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: WORDPRESS_SKILLS_QUERY_KEY } );
		},
	} );
}

export function useRemoveWordPressSkill() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticInstalled();
	return useMutation( {
		mutationFn: ( skillId: string ) => connector.removeWordPressSkillFromAllSites( skillId ),
		onMutate: ( skillId ) => applyOptimistic( [ skillId ], false ),
		onError: ( _error, _skillId, previous ) => {
			queryClient.setQueryData( WORDPRESS_SKILLS_QUERY_KEY, previous );
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: WORDPRESS_SKILLS_QUERY_KEY } );
		},
	} );
}
