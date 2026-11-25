import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import {
	GLOBAL_SKILLS_QUERY_KEY,
	SITE_AGENT_FILES_QUERY_KEY,
} from '@/data/queries/use-site-agent-files';
import type { SkillDraft } from '@/data/core';

const SKILL_QUERY_KEY = [ 'skill' ] as const;

// A skill opened to change it: one site's, or one of Studio's for all sites (`siteId` null).
export function useSkill( siteId: string | null, id: string | undefined ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...SKILL_QUERY_KEY, siteId, id ],
		queryFn: () => connector.getSkill( siteId, id ?? '' ),
		enabled: !! id,
		// The form starts from the files as they are now, not from an earlier read.
		gcTime: 0,
	} );
}

// Saves a new skill, or the changes to the one with `id`, then re-reads the lists it shows in.
export function useSaveSkill( siteId: string | null ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { id, draft }: { id?: string; draft: SkillDraft } ): Promise< string > =>
			id ? connector.updateSkill( siteId, id, draft ) : connector.createSkill( siteId, draft ),
		onSuccess: () =>
			Promise.all( [
				queryClient.invalidateQueries( { queryKey: GLOBAL_SKILLS_QUERY_KEY } ),
				queryClient.invalidateQueries( { queryKey: SITE_AGENT_FILES_QUERY_KEY } ),
			] ),
	} );
}
