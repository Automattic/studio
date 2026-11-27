import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import {
	GLOBAL_SKILLS_QUERY_KEY,
	SITE_AGENT_FILES_QUERY_KEY,
} from '@/data/queries/use-site-agent-files';
import type { GlobalSkill, GlobalSkillSource } from '@/data/core';

// The user's skills for all sites; none where the host doesn't keep them.
export function useGlobalSkills() {
	const connector = useConnector();
	return useQuery( {
		queryKey: GLOBAL_SKILLS_QUERY_KEY,
		queryFn: () => connector.getGlobalSkills(),
		enabled: connector.capabilities.globalSkills,
	} );
}

const UPDATE_GLOBAL_SKILLS_KEY = [ 'update-global-skills' ];

// Switches a skill on or off for all sites, or deletes one of Studio's own. A switch shows its
// new state at once; the changes run one after the other, and the lists are re-read after the
// last. Each site's list holds the global skills that are on, so those are re-read too.
export function useUpdateGlobalSkills() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: UPDATE_GLOBAL_SKILLS_KEY,
		scope: { id: UPDATE_GLOBAL_SKILLS_KEY[ 0 ] },
		mutationFn: (
			change: { source: GlobalSkillSource; id: string; enabled: boolean } | { remove: string }
		): Promise< void > =>
			'remove' in change
				? connector.removeGlobalSkill( change.remove )
				: connector.setGlobalSkillEnabled( change.source, change.id, change.enabled ),
		onMutate: async ( change ) => {
			if ( 'remove' in change ) {
				return;
			}
			await queryClient.cancelQueries( { queryKey: GLOBAL_SKILLS_QUERY_KEY } );
			queryClient.setQueryData< GlobalSkill[] >(
				GLOBAL_SKILLS_QUERY_KEY,
				( skills ) =>
					skills?.map( ( skill ) =>
						skill.source === change.source && skill.id === change.id
							? { ...skill, enabled: change.enabled }
							: skill
					)
			);
		},
		// A re-read while another change waits would show that change undone for a moment.
		onSettled: () =>
			queryClient.isMutating( { mutationKey: UPDATE_GLOBAL_SKILLS_KEY } ) === 1
				? Promise.all( [
						queryClient.invalidateQueries( { queryKey: GLOBAL_SKILLS_QUERY_KEY } ),
						queryClient.invalidateQueries( { queryKey: SITE_AGENT_FILES_QUERY_KEY } ),
				  ] )
				: undefined,
	} );
}
