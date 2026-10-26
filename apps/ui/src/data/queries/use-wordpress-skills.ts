import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { SITE_AGENT_FILES_QUERY_KEY } from '@/data/queries/use-site-agent-files';
import type { SkillStatus } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export const WORDPRESS_SKILLS_QUERY_KEY = [ 'wordpress-skills' ] as const;

export function useWordPressSkills() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WORDPRESS_SKILLS_QUERY_KEY,
		queryFn: () => connector.getWordPressSkillsStatusAllSites(),
	} );
}

// Skills for all sites change each site's files too.
function invalidateSkills( queryClient: QueryClient ) {
	void queryClient.invalidateQueries( { queryKey: WORDPRESS_SKILLS_QUERY_KEY } );
	void queryClient.invalidateQueries( { queryKey: SITE_AGENT_FILES_QUERY_KEY } );
}

// Flip installed state in the cache up front so toggles respond instantly;
// mutations roll back with the returned snapshot on error and re-sync from the
// connector on settled.
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
		onSettled: () => invalidateSkills( queryClient ),
	} );
}

// The Studio-wide switch: every skill on, or off, for all sites.
export function useSetAllWordPressSkills() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const applyOptimistic = useOptimisticInstalled();
	return useMutation( {
		mutationFn: async ( { skillIds, installed }: { skillIds: string[]; installed: boolean } ) => {
			for ( const skillId of skillIds ) {
				await ( installed
					? connector.installWordPressSkillToAllSites( skillId )
					: connector.removeWordPressSkillFromAllSites( skillId ) );
			}
		},
		onMutate: ( { skillIds, installed } ) => applyOptimistic( skillIds, installed ),
		onError: ( _error, _change, previous ) => {
			queryClient.setQueryData( WORDPRESS_SKILLS_QUERY_KEY, previous );
		},
		onSettled: () => invalidateSkills( queryClient ),
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
		onSettled: () => invalidateSkills( queryClient ),
	} );
}
