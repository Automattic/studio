import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';

export const WORDPRESS_SKILLS_QUERY_KEY = [ 'wordpress-skills' ] as const;

export function useWordPressSkills() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WORDPRESS_SKILLS_QUERY_KEY,
		queryFn: () => connector.getWordPressSkillsStatusAllSites(),
	} );
}

export function useInstallWordPressSkill() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( skillId: string ) => connector.installWordPressSkillToAllSites( skillId ),
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: WORDPRESS_SKILLS_QUERY_KEY } );
		},
	} );
}

export function useInstallAllWordPressSkills() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: async ( skillIds: string[] ) => {
			for ( const skillId of skillIds ) {
				await connector.installWordPressSkillToAllSites( skillId );
			}
		},
		onSettled: () => {
			void queryClient.invalidateQueries( { queryKey: WORDPRESS_SKILLS_QUERY_KEY } );
		},
	} );
}

export function useRemoveWordPressSkill() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( skillId: string ) => connector.removeWordPressSkillFromAllSites( skillId ),
		onSuccess: () => {
			void queryClient.invalidateQueries( { queryKey: WORDPRESS_SKILLS_QUERY_KEY } );
		},
	} );
}
