import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import {
	GLOBAL_SKILLS_QUERY_KEY,
	SITE_AGENT_FILES_QUERY_KEY,
} from '@/data/queries/use-site-agent-files';
import type { GlobalSkillSource } from '@/data/core';

// The user's skills for all sites; none where the host doesn't keep them.
export function useGlobalSkills() {
	const connector = useConnector();
	return useQuery( {
		queryKey: GLOBAL_SKILLS_QUERY_KEY,
		queryFn: () => connector.getGlobalSkills(),
		enabled: connector.capabilities.globalSkills,
	} );
}

// Switches a skill on or off for all sites, or deletes one of Studio's own. Each site's
// list holds the global skills that are on, so those are re-read too.
export function useUpdateGlobalSkills() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: (
			change: { source: GlobalSkillSource; id: string; enabled: boolean } | { remove: string }
		): Promise< void > =>
			'remove' in change
				? connector.removeGlobalSkill( change.remove )
				: connector.setGlobalSkillEnabled( change.source, change.id, change.enabled ),
		onSettled: () =>
			Promise.all( [
				queryClient.invalidateQueries( { queryKey: GLOBAL_SKILLS_QUERY_KEY } ),
				queryClient.invalidateQueries( { queryKey: SITE_AGENT_FILES_QUERY_KEY } ),
			] ),
	} );
}
